import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { Client, type SFTPWrapper } from "ssh2";
import type { Config } from "./config.js";

export interface ExecResult {
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export function fingerprint(key: Buffer): string {
  return "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Conexión SSH reutilizable con verificación estricta de la huella del servidor. */
export class Ssh {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private readonly cfg: Config["ssh"]) {}

  private connect(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    const expected = this.cfg.hostKeySha256.startsWith("SHA256:") ? this.cfg.hostKeySha256 : `SHA256:${this.cfg.hostKeySha256}`;
    this.connecting = new Promise<Client>((resolve, reject) => {
      const c = new Client();
      let mismatch: string | null = null;
      c.on("ready", () => {
        this.client = c;
        this.connecting = null;
        resolve(c);
      })
        .on("error", (err) => {
          this.client = null;
          this.connecting = null;
          reject(mismatch ? new Error(mismatch) : err);
        })
        .on("close", () => {
          this.client = null;
        })
        .connect({
          host: this.cfg.host,
          port: this.cfg.port,
          username: this.cfg.user,
          privateKey: readFileSync(this.cfg.privateKeyPath),
          passphrase: this.cfg.passphrase,
          readyTimeout: 20000,
          // Se fuerza ed25519 para que la huella coincida con la que imprime setup-vps.sh
          algorithms: { serverHostKey: ["ssh-ed25519"] },
          keepaliveInterval: 15000,
          keepaliveCountMax: 4,
          hostVerifier: (key: Buffer) => {
            const got = fingerprint(key);
            if (got !== expected) {
              mismatch = `La huella del servidor no coincide (esperada ${expected}, recibida ${got}). Conexión rechazada por seguridad.`;
              return false;
            }
            return true;
          },
        });
    });
    return this.connecting;
  }

  async exec(command: string, cwd: string, timeoutSec: number): Promise<ExecResult> {
    const c = await this.connect();
    const started = Date.now();
    const full = `cd ${shellQuote(cwd)} && ${command}`;
    return new Promise<ExecResult>((resolve, reject) => {
      c.exec(full, (err, stream) => {
        if (err) return reject(err);
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const LIMIT = 5_000_000;
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            stream.signal("KILL");
          } catch {
            /* algunos servidores no soportan señales */
          }
          stream.close();
        }, timeoutSec * 1000);
        stream
          .on("close", (code: number | null, signal?: string) => {
            clearTimeout(timer);
            resolve({ exitCode: code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started });
          })
          .on("data", (d: Buffer) => {
            if (stdout.length < LIMIT) stdout += d.toString("utf8");
          });
        stream.stderr.on("data", (d: Buffer) => {
          if (stderr.length < LIMIT) stderr += d.toString("utf8");
        });
      });
    });
  }

  private async sftp(): Promise<SFTPWrapper> {
    const c = await this.connect();
    return new Promise((resolve, reject) => c.sftp((err, s) => (err ? reject(err) : resolve(s))));
  }

  async readFile(path: string, maxBytes: number): Promise<{ content: string; size: number; truncated: boolean }> {
    const s = await this.sftp();
    try {
      const st = await new Promise<{ size: number; isFile: () => boolean }>((res, rej) => s.stat(path, (e, a) => (e ? rej(e) : res(a))));
      if (!st.isFile()) throw new Error(`${path} no es un archivo`);
      const len = Math.min(st.size, maxBytes);
      const buf = Buffer.alloc(len);
      await new Promise<void>((res, rej) =>
        s.open(path, "r", (e, h) => {
          if (e) return rej(e);
          if (len === 0) return s.close(h, () => res());
          s.read(h, buf, 0, len, 0, (e2) => s.close(h, () => (e2 ? rej(e2) : res())));
        }),
      );
      return { content: buf.toString("utf8"), size: st.size, truncated: st.size > maxBytes };
    } finally {
      s.end();
    }
  }

  async writeFile(path: string, content: string, mode: number): Promise<void> {
    const s = await this.sftp();
    try {
      await this.mkdirp(s, posix.dirname(path));
      const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
      await new Promise<void>((res, rej) => s.writeFile(tmp, content, { mode }, (e) => (e ? rej(e) : res())));
      await new Promise<void>((res, rej) =>
        s.rename(tmp, path, (e) => {
          if (!e) return res();
          // Algunos servidores SFTP no sobrescriben con rename: se borra y se reintenta.
          s.unlink(path, () => s.rename(tmp, path, (e2) => (e2 ? rej(e2) : res())));
        }),
      );
    } finally {
      s.end();
    }
  }

  private async mkdirp(s: SFTPWrapper, dir: string): Promise<void> {
    const parts = dir.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      await new Promise<void>((res) => s.mkdir(cur, () => res())); // ignora "ya existe"
    }
  }

  close(): void {
    this.client?.end();
    this.client = null;
  }
}
