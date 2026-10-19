import { posix } from "node:path";
import type { Config } from "./config.js";

export type Policy = Config["policy"];

export interface Verdict {
  ok: boolean;
  reason?: string;
}

const allow: Verdict = { ok: true };
const deny = (reason: string): Verdict => ({ ok: false, reason });

/** Rutas cuyo contenido nunca se lee ni se escribe a través del MCP. */
const SECRET_PATH = [
  /(^|\/)\.env(\.[\w.-]+)?$/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/,
  /\.(pem|key|p12|pfx)$/,
  /^\/etc\/(shadow|gshadow|sudoers)(\.d)?(\/|$)/,
  /^\/etc\/letsencrypt\/(live|archive)\//,
  /^\/root(\/|$)/,
];

/** Patrones prohibidos siempre, en cualquier modo. */
const HARD_DENY: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-zA-Z]*\s+)*(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b[^|;&]*\s(\/|~|\/\*|\*)(\s|$)/, "rm -rf sobre / o ~"],
  [/\bmkfs(\.\w+)?\b/, "formateo de discos"],
  [/\bdd\b[^|;&]*\bof=\/dev\//, "escritura directa a dispositivos"],
  [/\b(shutdown|reboot|poweroff|halt)\b/, "apagado o reinicio del servidor (usa contabo_power_action)"],
  [/\binit\s+[06]\b/, "apagado o reinicio del servidor"],
  [/\bsystemctl\s+(stop|disable|mask|kill|poweroff|reboot|halt|isolate)\b/, "detener o deshabilitar servicios del sistema"],
  [/\bdocker\s+(system|volume|network|image|container|builder)\s+prune\b/, "limpieza global de Docker (afecta otros proyectos)"],
  [/\bdocker\s+compose\b[^|;&]*\bdown\b[^|;&]*\s(-v|--volumes)\b/, "docker compose down con borrado de volúmenes"],
  [/\b(userdel|useradd|usermod|passwd|chpasswd|groupdel|visudo)\b/, "gestión de usuarios del sistema"],
  [/\b(iptables|ip6tables|nft)\s+(-F|--flush|flush)\b/, "vaciar el firewall"],
  [/\bufw\s+(disable|reset|delete)\b/, "desactivar o borrar reglas del firewall"],
  [/\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?[0-7]*777\s+\/(\s|$)/, "permisos 777 sobre /"],
  [/\bcrontab\s+-r\b/, "borrar el crontab"],
  [/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, "ejecutar scripts descargados"],
  [/:\(\)\s*\{\s*:\|:&\s*\}\s*;/, "fork bomb"],
  [/\bkill\s+(-9\s+)?1\b/, "matar init"],
  [/\bapt(-get)?\s+(remove|purge|autoremove|dist-upgrade|full-upgrade)\b/, "desinstalar o actualizar paquetes del sistema"],
  [/\/etc\/ssh\//, "modificar la configuración de SSH"],
  [/\bsudo\s+(-i|-s|su|bash|sh)\b/, "shell de root"],
  [/\bsu\s+(-|root)\b/, "cambiar a root"],
];

/** Separa un comando en segmentos por ;, &&, ||, | y saltos de línea, respetando comillas. */
export function splitSegments(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < cmd.length) {
        cur += c + cmd[++i];
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n") {
      out.push(cur);
      cur = "";
      continue;
    }
    if (c === "&" && cmd[i - 1] !== ">" && cmd[i + 1] !== ">") {
      // proceso en segundo plano: se trata como separador
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (q) throw new Error("comillas sin cerrar");
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Tokeniza un segmento en palabras (comillas simples/dobles). */
export function tokenize(seg: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < seg.length) cur += seg[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += c;
    has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

export function isUnder(path: string, roots: string[]): boolean {
  const p = posix.normalize(path);
  return roots.some((r) => {
    const root = posix.normalize(r).replace(/\/+$/, "");
    return p === root || p.startsWith(root + "/");
  });
}

export function isSecretPath(path: string): boolean {
  const p = posix.normalize(path);
  return SECRET_PATH.some((re) => re.test(p));
}

function resolvePath(arg: string, cwd: string): string {
  if (arg.startsWith("~")) return "/__home__" + arg.slice(1); // nunca bajo raíces permitidas
  return posix.normalize(arg.startsWith("/") ? arg : posix.join(cwd, arg));
}

function looksLikePath(a: string): boolean {
  return a.startsWith("/") || a.startsWith("./") || a.startsWith("../") || a.startsWith("~") || a.includes("/");
}

const READ_ONLY = new Set([
  "ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "wc", "du", "df", "free", "uptime", "uname",
  "whoami", "id", "date", "ps", "ss", "netstat", "hostname", "echo", "printf", "pwd", "stat", "which",
  "file", "sort", "uniq", "cut", "tr", "jq", "nproc", "lsb_release", "true", "test", "[", "basename",
  "dirname", "realpath", "readlink", "sha256sum", "md5sum", "diff", "tree", "lsblk", "getent",
]);
const WRITE_FS = new Set(["mkdir", "cp", "mv", "rm", "touch", "ln", "chmod", "chown", "tar", "gzip", "gunzip", "zip", "unzip", "rmdir"]);

export interface ExecContext {
  cwd: string;
  policy: Policy;
}

/** Verifica un comando completo contra la política. */
export function checkCommand(command: string, ctx: ExecContext): Verdict {
  const { policy } = ctx;
  if (!command.trim()) return deny("comando vacío");
  if (command.length > 8000) return deny("comando demasiado largo");

  for (const [re, why] of HARD_DENY) if (re.test(command)) return deny(`bloqueado siempre: ${why}`);

  if (!isUnder(ctx.cwd, [...policy.writeRoots, ...policy.readRoots]))
    return deny(`directorio de trabajo fuera de las raíces permitidas: ${ctx.cwd}`);

  if (/`|\$\(|<\(|>\(/.test(command)) return deny("no se permite sustitución de comandos (` `, $(), <(), >())");
  if (/\beval\b|\bsource\b|^\s*\.\s/.test(command)) return deny("no se permite eval/source");

  let segments: string[];
  try {
    segments = splitSegments(command);
  } catch (e) {
    return deny((e as Error).message);
  }

  let cwd = ctx.cwd;
  for (const seg of segments) {
    const v = checkSegment(seg, { ...ctx, cwd });
    if (!v.ok) return deny(`${v.reason} → en: ${seg}`);
    const t = tokenize(seg);
    if (t[0] === "cd") cwd = resolvePath(t[1] ?? policy.projectDir, cwd);
  }
  return allow;
}

function checkRedirections(seg: string, ctx: ExecContext): Verdict {
  // Captura destinos de > y >> (excluye 2>&1 y similares)
  const re = /(?:^|[^<>&\d])(\d?)(>>?)\s*(?!&)("[^"]*"|'[^']*'|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    const target = m[3].replace(/^["']|["']$/g, "");
    if (target === "/dev/null") continue;
    const p = resolvePath(target, ctx.cwd);
    if (!isUnder(p, ctx.policy.writeRoots)) return deny(`redirección fuera de las raíces de escritura: ${p}`);
    if (isSecretPath(p)) return deny(`no se escriben archivos de secretos: ${p}`);
  }
  if (/<\s*[^\s<]/.test(seg.replace(/<<-?\s*'?\w+'?/g, ""))) {
    // entrada desde archivo: validar lectura
    const m2 = seg.match(/<\s*("[^"]*"|'[^']*'|[^\s]+)/);
    if (m2) {
      const p = resolvePath(m2[1].replace(/^["']|["']$/g, ""), ctx.cwd);
      if (isSecretPath(p)) return deny(`no se leen archivos de secretos: ${p}`);
    }
  }
  return allow;
}

function stripRedirections(seg: string): string {
  return seg.replace(/\d?>>?\s*&?\d*\s*("[^"]*"|'[^']*'|[^\s]+)?/g, " ").replace(/<\s*("[^"]*"|'[^']*'|[^\s]+)/g, " ");
}

function checkSegment(rawSeg: string, ctx: ExecContext): Verdict {
  const { policy, cwd } = ctx;
  const red = checkRedirections(rawSeg, ctx);
  if (!red.ok) return red;

  let tokens = tokenize(stripRedirections(rawSeg));
  // variables de entorno en línea: FOO=bar cmd
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  if (!tokens.length) return allow;

  let sudo = false;
  if (tokens[0] === "sudo") {
    sudo = true;
    tokens = tokens.slice(1).filter((t, i) => !(i === 0 && t === "-n"));
  }
  const [bin, ...args] = tokens;
  const name = posix.basename(bin);

  // Ningún argumento puede apuntar a archivos de secretos (lectura o escritura),
  // salvo comandos que solo consultan si existen (test, [, ls, stat).
  const metadataOnly = /^(test|\[|ls|stat)$/.test(name);
  for (const a of metadataOnly ? [] : args) {
    if (a.startsWith("-")) continue;
    if (isSecretPath(resolvePath(a, cwd))) return deny(`acceso a archivo de secretos: ${a}`);
  }
  if (/^(env|printenv|set|export|declare)$/.test(name)) return deny("no se listan variables de entorno (podrían contener secretos)");

  if (sudo) return checkSudo(name, args);

  if (policy.mode === "open") return allow;

  // ---- modo restringido ----
  if (READ_ONLY.has(name)) {
    return checkReadArgs(name, args, ctx);
  }
  if (name === "find") {
    if (args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(a)))
      return deny("find solo en modo lectura (sin -delete/-exec)");
    return checkReadArgs(name, args, ctx);
  }
  if (name === "sed") {
    if (args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) return checkWriteArgs(args, ctx);
    return checkReadArgs(name, args, ctx);
  }
  if (name === "top") return args.includes("-b") ? allow : deny("usa top -bn1");
  if (name === "journalctl") return args.includes("--no-pager") ? allow : deny("usa journalctl --no-pager");
  if (name === "systemctl") {
    const sub = args.find((a) => !a.startsWith("-"));
    return sub && /^(status|is-active|is-enabled|list-units|list-timers|show|cat)$/.test(sub)
      ? allow
      : deny("systemctl solo para consulta (status, is-active, list-units…); reload de nginx vía sudo");
  }
  if (name === "nginx") return args.join(" ") === "-t" || args.join(" ") === "-T" ? allow : deny("nginx solo -t/-T");
  if (name === "openssl") return /^(x509|s_client|version|rand)$/.test(args[0] ?? "") ? allow : deny("openssl solo x509, s_client, version o rand");
  if (name === "ip") return /^(a|addr|address|r|route|link)$/.test(args[0] ?? "") && !args.includes("add") && !args.includes("del") ? allow : deny("ip solo consulta");
  if (name === "crontab") {
    if (args[0] === "-l") return allow;
    const f = args.find((a) => !a.startsWith("-"));
    if (f && isUnder(resolvePath(f, cwd), [policy.projectDir])) return allow;
    return deny("crontab solo -l o instalar un archivo del proyecto");
  }
  if (name === "curl" || name === "wget") return checkCurl(name, args, policy);
  if (name === "git") return checkGit(args, ctx);
  if (name === "docker") return checkDocker(args, ctx);
  if (name === "bash" || name === "sh") {
    const script = args.find((a) => !a.startsWith("-"));
    if (args.includes("-c")) return deny("bash -c no permitido; ejecuta los comandos directamente");
    if (!script) return deny("shell interactiva no permitida");
    return isUnder(resolvePath(script, cwd), [policy.scriptsDir])
      ? allow
      : deny("solo se ejecutan scripts de infra/scripts del proyecto");
  }
  if (bin.startsWith("./") || bin.startsWith("/")) {
    return isUnder(resolvePath(bin, cwd), [policy.scriptsDir])
      ? allow
      : deny("solo se ejecutan scripts de infra/scripts del proyecto");
  }
  if (WRITE_FS.has(name)) return checkWriteArgs(args, ctx, name);
  if (name === "awk" || name === "gawk") {
    return /system\s*\(|\|\s*getline|print\s*>/.test(args.join(" ")) ? deny("awk sin system()/redirecciones") : checkReadArgs(name, args, ctx);
  }
  if (name === "sleep") return Number(args[0]) <= 60 ? allow : deny("sleep máximo 60 s");
  if (name === "cd") {
    const p = resolvePath(args[0] ?? "/", cwd);
    return isUnder(p, [...policy.writeRoots, ...policy.readRoots]) ? allow : deny(`cd fuera de raíces permitidas: ${p}`);
  }
  if (name === "certbot") return deny("certbot requiere sudo: usa sudo certbot certonly|renew|certificates");

  return deny(`comando no permitido en modo restringido: ${name}`);
}

function checkSudo(name: string, args: string[]): Verdict {
  const a = args.join(" ");
  if (name === "nginx" && (a === "-t" || a === "-T")) return allow;
  if (name === "systemctl" && /^(reload|status) nginx(\.service)?$/.test(a)) return allow;
  if (name === "certbot" && /^(certonly|renew|certificates)\b/.test(a) && !/--force-renewal|delete|revoke/.test(a)) return allow;
  if (name === "ufw" && /^(status|allow (80|443)(\/tcp)?)$/.test(a)) return allow;
  return deny(`sudo solo para: nginx -t, systemctl reload|status nginx, certbot certonly|renew|certificates, ufw status|allow 80/443`);
}

function checkReadArgs(name: string, args: string[], ctx: ExecContext): Verdict {
  for (const a of args) {
    if (!looksLikePath(a)) continue;
    const p = resolvePath(a, ctx.cwd);
    if (!isUnder(p, [...ctx.policy.readRoots, ...ctx.policy.writeRoots, "/proc/meminfo", "/proc/cpuinfo", "/etc/os-release", "/dev/null"]))
      return deny(`${name}: lectura fuera de las raíces permitidas: ${p}`);
  }
  return allow;
}

function checkWriteArgs(args: string[], ctx: ExecContext, name = "escritura"): Verdict {
  const roots = ctx.policy.writeRoots;
  const readable = [...ctx.policy.readRoots, ...roots];
  let operands = args.filter((a) => !a.startsWith("-"));
  if (name === "chmod" || name === "chown") operands = operands.slice(1); // modo / dueño
  if (name === "sed") operands = operands.slice(1); // expresión
  const isCp = name === "cp";
  const dest = isCp ? operands[operands.length - 1] : undefined;
  for (const a of operands) {
    const p = resolvePath(a, ctx.cwd);
    const allowedRoots = isCp && a !== dest ? readable : roots;
    if (!isUnder(p, allowedRoots)) return deny(`${name}: ruta fuera de las raíces permitidas: ${p}`);
    if (isSecretPath(p)) return deny(`${name}: no se tocan archivos de secretos: ${p}`);
    const isRoot = roots.some((r) => posix.normalize(r).replace(/\/+$/, "") === p);
    if (isRoot && /^(rm|mv|rmdir|chmod|chown)$/.test(name)) return deny(`${name}: no se puede alterar la raíz ${p}`);
  }
  return allow;
}

const CURL_FLAGS_WITH_VALUE = new Set(["-H", "--header", "-m", "--max-time", "--connect-timeout", "-w", "--write-out", "-X", "--request", "-o", "--output", "-A", "--user-agent", "--resolve"]);
const CURL_BOOL_LONG = new Set(["--silent", "--show-error", "--head", "--location", "--insecure", "--fail", "--include", "--verbose", "--compressed", "--http1.1", "--http2"]);

function checkCurl(name: string, args: string[], policy: Policy): Verdict {
  if (name !== "curl") return deny("usa curl (wget no permitido)");
  const urls: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (CURL_FLAGS_WITH_VALUE.has(a)) {
      const v = args[++i] ?? "";
      if ((a === "-X" || a === "--request") && !/^(GET|HEAD)$/i.test(v)) return deny("curl: solo GET o HEAD");
      if ((a === "-o" || a === "--output") && v !== "/dev/null") return deny("curl: -o solo hacia /dev/null");
      continue;
    }
    if (CURL_BOOL_LONG.has(a)) continue;
    if (/^-[sSILkvfi]+$/.test(a)) continue;
    if (a.startsWith("-")) return deny(`curl: opción no permitida ${a} (solo lectura)`);
    urls.push(a);
  }
  if (!urls.length) return deny("curl: indica la URL con http(s)://");
  for (const u of urls) {
    let host = "";
    try {
      const url = new URL(u);
      if (!/^https?:$/.test(url.protocol)) return deny(`curl: protocolo no permitido ${url.protocol}`);
      host = url.hostname;
    } catch {
      return deny(`curl: URL inválida ${u}`);
    }
    if (!policy.curlHosts.includes(host)) return deny(`curl: host no permitido ${host} (permitidos: ${policy.curlHosts.join(", ")})`);
  }
  return allow;
}

function checkGit(args: string[], ctx: ExecContext): Verdict {
  const sub = args.find((a) => !a.startsWith("-"));
  if (!sub) return deny("git sin subcomando");
  if (!isUnder(ctx.cwd, [ctx.policy.projectDir])) return deny(`git solo dentro de ${ctx.policy.projectDir}`);
  if (/^(status|log|diff|show|rev-parse|branch|remote|fetch|pull|checkout|switch|describe|tag|ls-files|stash)$/.test(sub)) {
    if (sub === "pull" && args.includes("--force")) return deny("git pull --force no permitido");
    if (sub === "checkout" && args.includes("--")) return deny("git checkout -- (descarta cambios) no permitido; usa git stash");
    return allow;
  }
  if (sub === "clone") {
    const target = args.filter((a) => !a.startsWith("-")).slice(2)[0];
    return target && isUnder(resolvePath(target, ctx.cwd), [ctx.policy.projectDir]) ? allow : deny("git clone solo hacia el directorio del proyecto");
  }
  return deny(`git ${sub} no permitido en el VPS (los cambios se hacen en el repo y llegan con git pull)`);
}

function checkDocker(args: string[], ctx: ExecContext): Verdict {
  const { policy } = ctx;
  const sub = args[0];
  if (!sub) return deny("docker sin subcomando");
  if (/^(ps|images|info|version|stats)$/.test(sub)) {
    if (sub === "stats" && !args.includes("--no-stream")) return deny("docker stats --no-stream");
    return allow;
  }
  const own = (n: string) => n.startsWith(policy.composeProject);
  if (/^(logs|inspect|top|port)$/.test(sub)) return allow; // lectura
  if (/^(restart|stop|start|rm|kill|exec|cp)$/.test(sub)) {
    const targets = args.slice(1).filter((a) => !a.startsWith("-"));
    if (!targets.length) return deny(`docker ${sub} sin contenedor`);
    const container = sub === "cp" ? targets.map((t) => t.split(":")[0]).find((t) => !t.startsWith("/") && !t.startsWith(".")) : targets[0];
    if (!container || !own(container)) return deny(`docker ${sub} solo sobre contenedores ${policy.composeProject}*`);
    if (sub === "exec") {
      const rest = targets.slice(1).join(" ");
      if (/^(ba|z)?sh$/.test(rest.trim())) return deny("docker exec sin shell interactiva; ejecuta el comando directo");
      if (/\b(env|printenv|set|export)\b/.test(rest) || /(^|\s|\/)\.env\b/.test(rest) || /\/proc\/\d+\/environ|\/proc\/self\/environ/.test(rest))
        return deny("docker exec: no se leen variables de entorno ni archivos .env");
    }
    return allow;
  }
  if (sub === "compose") {
    const csub = args.slice(1).find((a, i, arr) => !a.startsWith("-") && !/^(-f|--file|-p|--project-name|--env-file|--profile)$/.test(arr[i - 1] ?? ""));
    const pIdx = args.findIndex((a) => a === "-p" || a === "--project-name");
    const projectOk = (pIdx >= 0 && own(args[pIdx + 1] ?? "")) || isUnder(ctx.cwd, [policy.projectDir]);
    if (!projectOk) return deny(`docker compose solo dentro de ${policy.projectDir} o con -p ${policy.composeProject}`);
    if (pIdx >= 0 && !own(args[pIdx + 1] ?? "")) return deny(`docker compose -p debe empezar por ${policy.composeProject}`);
    const fIdx = args.findIndex((a) => a === "-f" || a === "--file");
    if (fIdx >= 0 && !isUnder(resolvePath(args[fIdx + 1] ?? "", ctx.cwd), [policy.projectDir])) return deny("docker compose -f debe apuntar a un archivo del proyecto");
    if (!csub) return deny("docker compose sin subcomando");
    if (/^(ps|logs|config|images|top|version|ls|pull|build|up|restart|stop|start|exec|run|down|create|port|events)$/.test(csub)) return allow;
    return deny(`docker compose ${csub} no permitido`);
  }
  if (sub === "build" || sub === "pull" || sub === "tag") return allow;
  return deny(`docker ${sub} no permitido en modo restringido`);
}

/** Descripción legible de la política, para que el agente sepa qué puede hacer. */
export function describePolicy(policy: Policy): string {
  return [
    `Modo: ${policy.mode}`,
    `Directorio del proyecto: ${policy.projectDir} (repo en ${policy.projectDir}/app) · scripts: ${policy.scriptsDir} · proyecto de Compose: ${policy.composeProject}`,
    `Raíces de escritura: ${policy.writeRoots.join(", ")}`,
    `Raíces de lectura: ${policy.readRoots.join(", ")}`,
    `curl/wget solo GET/HEAD hacia: ${policy.curlHosts.join(", ")}`,
    "Bloqueado siempre: apagar/reiniciar el servidor, detener servicios del sistema, prune global de Docker, compose down -v, gestión de usuarios, firewall, SSH, apt remove/upgrade, shell de root, leer o escribir .env/claves/certificados privados, listar variables de entorno, sustitución de comandos ($(), ``), eval/source.",
    policy.mode === "restricted"
      ? "Modo restringido permite: lectura (ls, cat, grep, tail, df, free, ps, ss…), git en el proyecto (status/log/diff/fetch/pull/checkout/clone), docker de consulta, docker compose dentro del proyecto, docker exec/restart/logs sobre contenedores izao*, operaciones de archivos dentro de las raíces de escritura, scripts de infra/scripts, systemctl/journalctl de consulta, sudo solo para nginx -t, systemctl reload nginx, certbot certonly|renew|certificates y ufw status|allow 80/443."
      : "Modo abierto: todo lo que no esté en la lista de bloqueo.",
  ].join("\n");
}
