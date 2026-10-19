/** Oculta valores sensibles en la salida antes de devolverla al agente. */
const NAME = String.raw`[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|PASS|TOKEN|PRIVATE|API_?KEY|ACCESS_?KEY|SERVICE_ROLE|DSN|DATABASE_URL|REDIS_URL|ENCRYPTION_KEY|PEPPER|CREDENTIAL)[A-Za-z0-9_]*`;

const RULES: Array<[RegExp, string]> = [
  // NAME=valor  /  "NAME=valor" (docker inspect, env)
  [new RegExp(`(${NAME})=([^\\s"',]+)`, "gi"), "$1=***"],
  // NAME: valor  (YAML de docker compose config)
  [new RegExp(`(${NAME})(\\s*:\\s*)("?)([^\\s"']+)("?)`, "gi"), "$1$2$3***$5"],
  // "NAME": "valor" (JSON)
  [new RegExp(`("${NAME}"\\s*:\\s*")([^"]+)(")`, "gi"), "$1***$3"],
  // Formatos de llaves conocidos
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/g, "sb_$1_***"],
  [/\b(prv|pub)_(prod|test)_[A-Za-z0-9]{10,}/g, "$1_$2_***"],
  [/\b(prod|test)_(events|integrity)_[A-Za-z0-9]{10,}/g, "$1_$2_***"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "<jwt-oculto>"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-***"],
  [/\bEAA[A-Za-z0-9]{20,}/g, "EAA***"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1***"],
  [/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1***@"],
  [/(redis:\/\/[^:\s]*:)[^@\s]+@/gi, "$1***@"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<llave-privada-oculta>"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

/** Recorta salidas largas conservando el inicio y el final. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n… [${text.length - max} caracteres omitidos] …\n\n${text.slice(-tail)}`;
}
