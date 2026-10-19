// Verificación manual de la configuración: npm run check
import { loadConfig } from "./config.js";
import { Ssh } from "./ssh.js";
import { Contabo } from "./contabo.js";

const cfg = loadConfig();
console.log(`SSH → ${cfg.ssh.user}@${cfg.ssh.host}:${cfg.ssh.port}`);
const ssh = new Ssh(cfg.ssh);
try {
  const r = await ssh.exec("whoami && id && docker ps --format '{{.Names}}' | head -20", "/", 20);
  console.log(r.exitCode === 0 ? "SSH OK" : "SSH respondió con error");
  console.log(r.stdout || r.stderr);
} catch (e) {
  console.error("SSH falló:", (e as Error).message);
  process.exitCode = 1;
} finally {
  ssh.close();
}

if (cfg.contabo) {
  try {
    const k = new Contabo(cfg.contabo);
    const r = await k.getInstance();
    const inst = (r.data?.[0] ?? {}) as Record<string, unknown>;
    console.log(`API de Contabo OK → ${inst.displayName ?? inst.name ?? cfg.contabo.instanceId} · estado ${inst.status} · región ${inst.region}`);
  } catch (e) {
    console.error("API de Contabo falló:", (e as Error).message);
    process.exitCode = 1;
  }
} else {
  console.log("API de Contabo no configurada (opcional).");
}
