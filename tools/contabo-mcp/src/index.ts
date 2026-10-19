#!/usr/bin/env node
import { posix } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, type Config } from "./config.js";
import { checkCommand, describePolicy, isSecretPath, isUnder } from "./policy.js";
import { redact, truncate } from "./redact.js";
import { Ssh, type ExecResult } from "./ssh.js";
import { Contabo, snapshotName } from "./contabo.js";
import { Audit } from "./audit.js";

let cfg: Config | null = null;
let configError: string | null = null;
try {
  cfg = loadConfig();
} catch (e) {
  configError = (e as Error).message;
}

const audit = new Audit(cfg?.auditFile ?? "logs/audit.jsonl");
const ssh = cfg ? new Ssh(cfg.ssh) : null;
const contabo = cfg?.contabo ? new Contabo(cfg.contabo) : null;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], isError });

function need<T>(v: T | null, what: string): T {
  if (configError) throw new Error(`Configuración incompleta: ${configError}`);
  if (!v) throw new Error(`${what}: falta su configuración en tools/contabo-mcp/.env`);
  return v;
}

async function guarded(tool: string, input: Record<string, unknown>, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  const started = Date.now();
  try {
    const r = await fn();
    audit.log({ tool, input, ok: !r.isError, ms: Date.now() - started });
    return r;
  } catch (e) {
    const msg = (e as Error).message;
    audit.log({ tool, input, ok: false, error: msg, ms: Date.now() - started });
    return text(`Error: ${redact(msg)}`, true);
  }
}

function formatExec(r: ExecResult, max: number): string {
  const head = `exit: ${r.exitCode ?? "?"}${r.signal ? ` (señal ${r.signal})` : ""} · ${Math.round(r.durationMs / 100) / 10} s${r.timedOut ? " · TIEMPO AGOTADO" : ""}`;
  const out = redact(r.stdout).trimEnd();
  const err = redact(r.stderr).trimEnd();
  let body = head;
  if (out) body += `\n--- stdout ---\n${out}`;
  if (err) body += `\n--- stderr ---\n${err}`;
  return truncate(body, max);
}

const server = new McpServer({ name: "contabo", version: "1.0.0" });

server.registerTool(
  "vps_policy",
  {
    title: "Política de seguridad del VPS",
    description: "Muestra qué comandos y rutas permite el MCP en el VPS. Consúltala antes de planear trabajo en el servidor o cuando un comando sea bloqueado.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () =>
    guarded("vps_policy", {}, async () => {
      const c = need(cfg, "El MCP");
      const lines = [
        describePolicy(c.policy),
        `Servidor: ${c.ssh.user}@${c.ssh.host}:${c.ssh.port}`,
        `API de Contabo: ${contabo ? `configurada (instancia ${contabo.instanceId}; acciones de energía ${contabo.powerActionsAllowed ? "HABILITADAS" : "deshabilitadas"})` : "no configurada"}`,
        `Auditoría: ${c.auditFile}`,
      ];
      return text(lines.join("\n"));
    }),
);

server.registerTool(
  "vps_inventory",
  {
    title: "Inventario del VPS",
    description: "Inventario de solo lectura del servidor: sistema, memoria, disco, contenedores Docker, puertos en uso, Nginx y otros proxies, y contenido del directorio del proyecto. Ejecútalo antes de cualquier cambio de infraestructura.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () =>
    guarded("vps_inventory", {}, async () => {
      const c = need(cfg, "El MCP");
      const s = need(ssh, "SSH");
      const dir = c.policy.projectDir;
      const script = [
        "echo '== sistema'; uname -a; head -3 /etc/os-release; uptime; echo \"cpus: $(nproc)\"; free -m; df -h /",
        "echo; echo '== docker'; docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}' 2>&1",
        "echo; echo '== docker compose (proyectos)'; docker compose ls 2>&1",
        "echo; echo '== puertos en escucha'; (ss -tulpn 2>/dev/null || ss -tuln) | head -60",
        "echo; echo '== nginx'; (nginx -v 2>&1; ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null) || echo 'sin nginx en el host'",
        "echo; echo '== otros proxies'; (command -v caddy; command -v traefik; docker ps --format '{{.Names}} {{.Image}}' | grep -Ei 'traefik|caddy|nginx|proxy') 2>/dev/null || true",
        `echo; echo '== proyecto ${dir}'; ls -la ${dir} 2>&1 | head -40`,
        "echo; echo '== usuario'; id",
      ].join("; ");
      const r = await s.exec(script, "/", 60);
      return text(formatExec(r, c.policy.maxOutputChars));
    }),
);

server.registerTool(
  "vps_exec",
  {
    title: "Ejecutar comando en el VPS",
    description:
      "Ejecuta un comando en el VPS por SSH, validado por la política de seguridad (consulta vps_policy). La salida se devuelve con secretos ocultos. Para builds largos sube timeout_seconds (máx. 1800). Usa snapshot_first=true antes de cambios de infraestructura difíciles de revertir.",
    inputSchema: {
      command: z.string().min(1).describe("Comando de shell. Sin $(), backticks, eval ni source."),
      cwd: z.string().optional().describe("Directorio de trabajo absoluto. Por defecto, el directorio del proyecto."),
      timeout_seconds: z.number().int().positive().optional(),
      snapshot_first: z.boolean().optional().describe("Crea un snapshot de Contabo antes de ejecutar."),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  async ({ command, cwd, timeout_seconds, snapshot_first }) =>
    guarded("vps_exec", { command, cwd, timeout_seconds, snapshot_first }, async () => {
      const c = need(cfg, "El MCP");
      const s = need(ssh, "SSH");
      const dir = posix.normalize(cwd ?? c.policy.projectDir);
      if (!dir.startsWith("/")) return text("cwd debe ser una ruta absoluta", true);
      const v = checkCommand(command, { cwd: dir, policy: c.policy });
      if (!v.ok) return text(`Bloqueado por la política: ${v.reason}\nConsulta vps_policy. Si de verdad se necesita, pide al usuario que lo ejecute él mismo.`, true);

      let snap = "";
      if (snapshot_first) {
        const k = need(contabo, "La API de Contabo");
        const name = snapshotName();
        await k.createSnapshot(name, `Antes de: ${command.slice(0, 200)}`);
        snap = `Snapshot creado: ${name}\n`;
      }
      const timeout = Math.min(timeout_seconds ?? c.policy.defaultTimeoutSec, c.policy.maxTimeoutSec);
      const r = await s.exec(command, dir, timeout);
      return text(snap + formatExec(r, c.policy.maxOutputChars), r.timedOut);
    }),
);

server.registerTool(
  "vps_read_file",
  {
    title: "Leer archivo del VPS",
    description: "Lee un archivo de texto del VPS dentro de las raíces de lectura. Nunca lee .env, llaves ni certificados privados.",
    inputSchema: {
      path: z.string().min(1).describe("Ruta absoluta"),
      max_bytes: z.number().int().positive().max(500_000).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ path, max_bytes }) =>
    guarded("vps_read_file", { path }, async () => {
      const c = need(cfg, "El MCP");
      const s = need(ssh, "SSH");
      const p = posix.normalize(path);
      if (!p.startsWith("/")) return text("La ruta debe ser absoluta", true);
      if (isSecretPath(p)) return text("Bloqueado: archivo de secretos", true);
      if (!isUnder(p, [...c.policy.readRoots, ...c.policy.writeRoots])) return text(`Bloqueado: fuera de las raíces de lectura (${c.policy.readRoots.join(", ")})`, true);
      const r = await s.readFile(p, max_bytes ?? 100_000);
      const note = r.truncated ? `\n\n[archivo de ${r.size} bytes; se muestran los primeros ${max_bytes ?? 100_000}]` : "";
      return text(truncate(redact(r.content), c.policy.maxOutputChars) + note);
    }),
);

server.registerTool(
  "vps_write_file",
  {
    title: "Escribir archivo en el VPS",
    description: "Crea o reemplaza (de forma atómica) un archivo de texto dentro de las raíces de escritura del VPS. No escribe .env ni llaves: los secretos los carga el usuario.",
    inputSchema: {
      path: z.string().min(1).describe("Ruta absoluta"),
      content: z.string(),
      mode: z.string().regex(/^[0-7]{3,4}$/).optional().describe("Permisos en octal, p. ej. 644 o 755"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ path, content, mode }) =>
    guarded("vps_write_file", { path, bytes: content.length, mode }, async () => {
      const c = need(cfg, "El MCP");
      const s = need(ssh, "SSH");
      const p = posix.normalize(path);
      if (!p.startsWith("/")) return text("La ruta debe ser absoluta", true);
      if (isSecretPath(p)) return text("Bloqueado: no se escriben archivos de secretos; pide al usuario que lo haga", true);
      if (!isUnder(p, c.policy.writeRoots)) return text(`Bloqueado: fuera de las raíces de escritura (${c.policy.writeRoots.join(", ")})`, true);
      if (content.length > 2_000_000) return text("Archivo demasiado grande (máx. 2 MB); súbelo por git", true);
      await s.writeFile(p, content, parseInt(mode ?? "644", 8));
      return text(`Escrito ${p} (${Buffer.byteLength(content)} bytes, modo ${mode ?? "644"})`);
    }),
);

server.registerTool(
  "vps_docker_logs",
  {
    title: "Logs de servicios del proyecto",
    description: "Últimas líneas de logs de un servicio de Docker Compose del proyecto (o de todos). Los secretos se ocultan.",
    inputSchema: {
      service: z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/).optional(),
      lines: z.number().int().positive().max(2000).optional(),
      since: z.string().regex(/^\d+[smhd]$/).optional().describe("p. ej. 30m, 2h"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ service, lines, since }) =>
    guarded("vps_docker_logs", { service, lines, since }, async () => {
      const c = need(cfg, "El MCP");
      const s = need(ssh, "SSH");
      const cmd = `docker compose -p ${c.policy.composeProject} logs --no-color --tail ${lines ?? 200}${since ? ` --since ${since}` : ""}${service ? ` ${service}` : ""} 2>&1`;
      const r = await s.exec(cmd, c.policy.projectDir, 60);
      return text(formatExec(r, c.policy.maxOutputChars));
    }),
);

server.registerTool(
  "contabo_instance",
  {
    title: "Instancia de Contabo",
    description: "Datos de la instancia configurada (estado, IP, región, plan) o, con all=true, la lista de instancias de la cuenta.",
    inputSchema: { all: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ all }) =>
    guarded("contabo_instance", { all }, async () => {
      const k = need(contabo, "La API de Contabo");
      const r = all ? await k.listInstances() : await k.getInstance();
      return text(JSON.stringify(r?.data ?? r, null, 2));
    }),
);

server.registerTool(
  "contabo_snapshots",
  {
    title: "Snapshots de Contabo",
    description:
      "Lista, crea o borra snapshots de la instancia. Solo se pueden borrar snapshots creados por este MCP (nombre izao-mcp-…). Contabo limita la cantidad de snapshots por plan: si crear falla por límite, lista y borra el más antiguo de izao-mcp.",
    inputSchema: {
      action: z.enum(["list", "create", "delete"]),
      snapshot_id: z.string().optional(),
      description: z.string().max(255).optional(),
    },
  },
  async ({ action, snapshot_id, description }) =>
    guarded("contabo_snapshots", { action, snapshot_id }, async () => {
      const k = need(contabo, "La API de Contabo");
      if (action === "list") return text(JSON.stringify((await k.listSnapshots()).data, null, 2));
      if (action === "create") {
        const name = snapshotName();
        await k.createSnapshot(name, description || "Snapshot manual desde Claude Code");
        return text(`Snapshot solicitado: ${name}. Puede tardar unos minutos en quedar disponible.`);
      }
      if (!snapshot_id) return text("Falta snapshot_id", true);
      const snap = (await k.listSnapshots()).data.find((x) => x.snapshotId === snapshot_id);
      if (!snap) return text("Snapshot no encontrado", true);
      if (!snap.name.startsWith("izao-mcp-")) return text("Bloqueado: solo se borran snapshots creados por este MCP (izao-mcp-…)", true);
      await k.deleteSnapshot(snapshot_id);
      return text(`Snapshot ${snap.name} borrado`);
    }),
);

server.registerTool(
  "contabo_power_action",
  {
    title: "Encender, apagar o reiniciar el VPS",
    description:
      "Acciones de energía sobre el VPS (afectan a TODOS los proyectos del servidor). Deshabilitadas salvo CONTABO_ALLOW_POWER_ACTIONS=1. Requiere confirm_instance_id igual al ID de la instancia y aprobación explícita del usuario en la conversación.",
    inputSchema: {
      action: z.enum(["start", "stop", "restart", "shutdown"]),
      confirm_instance_id: z.string(),
    },
    annotations: { destructiveHint: true },
  },
  async ({ action, confirm_instance_id }) =>
    guarded("contabo_power_action", { action }, async () => {
      const k = need(contabo, "La API de Contabo");
      if (!k.powerActionsAllowed) return text("Deshabilitado: las acciones de energía están apagadas (CONTABO_ALLOW_POWER_ACTIONS). Pide al usuario que lo haga desde el panel de Contabo.", true);
      if (confirm_instance_id !== k.instanceId) return text("confirm_instance_id no coincide con la instancia configurada", true);
      await k.powerAction(action);
      return text(`Acción ${action} enviada a la instancia ${k.instanceId}`);
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[contabo-mcp] listo${configError ? ` (configuración incompleta: ${configError})` : ""}\n`);

const shutdown = () => {
  ssh?.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
