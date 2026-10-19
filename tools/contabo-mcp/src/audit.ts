import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redact } from "./redact.js";

export class Audit {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  log(entry: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    try {
      appendFileSync(this.file, redact(line) + "\n", { encoding: "utf8" });
    } catch (e) {
      // La auditoría nunca debe tumbar el servidor; se informa por stderr.
      process.stderr.write(`[contabo-mcp] no se pudo escribir auditoría: ${(e as Error).message}\n`);
    }
  }
}
