import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// dist/src/config.js -> raíz del paquete
export const PACKAGE_ROOT = resolve(here, "..", "..");

const envFile = process.env.CONTABO_MCP_ENV_FILE ?? join(PACKAGE_ROOT, ".env");
if (existsSync(envFile)) {
  // Node 22+: carga variables sin sobrescribir las ya definidas en el entorno.
  process.loadEnvFile(envFile);
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Falta la variable ${name} (revisa tools/contabo-mcp/.env)`);
  return v.trim();
}
function opt(name: string, def: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : def;
}
function list(name: string, def: string): string[] {
  return opt(name, def)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Config {
  contabo: {
    clientId: string;
    clientSecret: string;
    apiUser: string;
    apiPassword: string;
    instanceId: string;
    allowPowerActions: boolean;
  } | null;
  ssh: {
    host: string;
    port: number;
    user: string;
    privateKeyPath: string;
    passphrase?: string;
    hostKeySha256: string;
  };
  policy: {
    mode: "restricted" | "open";
    projectDir: string;
    scriptsDir: string;
    composeProject: string;
    writeRoots: string[];
    readRoots: string[];
    curlHosts: string[];
    maxOutputChars: number;
    defaultTimeoutSec: number;
    maxTimeoutSec: number;
  };
  auditFile: string;
}

export function loadConfig(): Config {
  const hasContabo = !!process.env.CONTABO_CLIENT_ID;
  const projectDir = opt("VPS_PROJECT_DIR", "/srv/izao");
  return {
    contabo: hasContabo
      ? {
          clientId: req("CONTABO_CLIENT_ID"),
          clientSecret: req("CONTABO_CLIENT_SECRET"),
          apiUser: req("CONTABO_API_USER"),
          apiPassword: req("CONTABO_API_PASSWORD"),
          instanceId: req("CONTABO_INSTANCE_ID"),
          allowPowerActions: opt("CONTABO_ALLOW_POWER_ACTIONS", "0") === "1",
        }
      : null,
    ssh: {
      host: req("VPS_HOST"),
      port: Number(opt("VPS_PORT", "22")),
      user: opt("VPS_USER", "izao"),
      privateKeyPath: req("VPS_SSH_KEY_PATH"),
      passphrase: process.env.VPS_SSH_KEY_PASSPHRASE || undefined,
      hostKeySha256: req("VPS_HOST_KEY_SHA256"),
    },
    policy: {
      mode: opt("VPS_POLICY", "restricted") === "open" ? "open" : "restricted",
      projectDir,
      scriptsDir: opt("VPS_SCRIPTS_DIR", `${projectDir}/app/infra/scripts`),
      composeProject: opt("VPS_COMPOSE_PROJECT", "izao"),
      writeRoots: list("VPS_WRITE_ROOTS", `${projectDir},/tmp/izao`),
      readRoots: list(
        "VPS_READ_ROOTS",
        `${projectDir},/tmp/izao,/etc/nginx,/var/log/nginx,/etc/letsencrypt/renewal`,
      ),
      curlHosts: list("VPS_CURL_ALLOWED_HOSTS", "localhost,127.0.0.1,izaoperfumeria.com,www.izaoperfumeria.com"),
      maxOutputChars: Number(opt("VPS_MAX_OUTPUT_CHARS", "40000")),
      defaultTimeoutSec: Number(opt("VPS_DEFAULT_TIMEOUT_SEC", "120")),
      maxTimeoutSec: Number(opt("VPS_MAX_TIMEOUT_SEC", "1800")),
    },
    auditFile: opt("CONTABO_MCP_AUDIT_FILE", join(PACKAGE_ROOT, "logs", "audit.jsonl")),
  };
}
