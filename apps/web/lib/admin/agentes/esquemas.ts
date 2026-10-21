/**
 * Configuración remota del agente de impresión editable en el panel (§15, `apps/print-agent/README.md`,
 * `docs/integraciones/agente-api.md`). Puro: sin servidor ni navegador.
 *
 * `print_agents.remote_config` es `{ print?, panel?, intervals? }`; el modo (`api`/`panel`) vive en su propia
 * columna. Los límites son los que acepta el agente (`izao_agent/config.py`): si el panel guardara algo fuera de
 * ellos, el agente descartaría toda la configuración remota.
 */
import { z } from 'zod';

export const MODOS_AGENTE = ['api', 'panel'] as const;
export type ModoAgente = (typeof MODOS_AGENTE)[number];

export const OPERACIONES_PANEL = [
  'goto',
  'click',
  'fill',
  'press',
  'select_option',
  'wait_for',
  'wait_ms',
  'expect_text',
  'download',
] as const;

const AJUSTES_IMPRESION = /^[A-Za-z0-9 ,=\-_.]*$/;

export const esquemaImpresion = z
  .object({
    copies: z.number().int('Las copias deben ser un número entero.').min(1, 'Mínimo 1 copia.').max(20, 'Máximo 20 copias.').optional(),
    print_settings: z
      .string()
      .trim()
      .max(100, 'Máximo 100 caracteres.')
      .regex(AJUSTES_IMPRESION, 'Solo letras, números, espacios y , = - _ .')
      .optional(),
  })
  .strict();

export const esquemaIntervalos = z
  .object({
    heartbeat_seconds: z.number().int().min(5, 'Mínimo 5 segundos.').max(600, 'Máximo 600 segundos.').optional(),
    claim_seconds: z.number().int().min(2, 'Mínimo 2 segundos.').max(300, 'Máximo 300 segundos.').optional(),
    panel_retry_seconds: z.number().int().min(30, 'Mínimo 30 segundos.').max(3600, 'Máximo 3600 segundos.').optional(),
  })
  .strict();

const selector = z.string().trim().min(1, 'El selector no puede estar vacío.').max(300, 'Selector demasiado largo.');

const accion = z
  .object({
    op: z.enum(OPERACIONES_PANEL),
    selector: selector.optional(),
    url: z.string().trim().url('URL no válida.').max(500).optional(),
    value: z.string().max(500).optional(),
    state: z.enum(['visible', 'attached', 'hidden', 'detached']).optional(),
    timeout_ms: z.number().int().min(100, 'Mínimo 100 ms.').max(120_000, 'Máximo 120000 ms.').optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const necesitaSelector = ['click', 'fill', 'select_option', 'wait_for'].includes(a.op);
    if (necesitaSelector && !a.selector) ctx.addIssue({ code: 'custom', path: ['selector'], message: `La acción "${a.op}" necesita un selector.` });
    if (a.op === 'download' && !a.selector && !a.url) ctx.addIssue({ code: 'custom', path: ['selector'], message: 'La descarga necesita un selector o una URL.' });
    if (['fill', 'select_option'].includes(a.op) && a.value === undefined) ctx.addIssue({ code: 'custom', path: ['value'], message: `La acción "${a.op}" necesita un valor.` });
    if (a.op === 'expect_text' && a.value === undefined) ctx.addIssue({ code: 'custom', path: ['value'], message: 'expect_text necesita el texto esperado.' });
  });

const paso = z
  .object({
    name: z.string().trim().min(1, 'El paso necesita un nombre.').max(60),
    enabled: z.boolean().optional(),
    actions: z.array(accion).max(40, 'Máximo 40 acciones por paso.'),
  })
  .strict();

function esHttps(valor: string): boolean {
  try {
    return new URL(valor).protocol === 'https:';
  } catch {
    return false;
  }
}

function expresionValida(patron: string): boolean {
  try {
    new RegExp(patron);
    return true;
  } catch {
    return false;
  }
}

export const esquemaPanel = z
  .object({
    base_url: z
      .string()
      .trim()
      .max(500)
      .refine(esHttps, 'La URL del panel de MasterShop debe empezar por https://'),
    logged_in_selector: selector.optional(),
    logged_out_selectors: z.array(selector).max(20).optional(),
    challenge_selectors: z.array(selector).max(20).optional(),
    challenge_title_patterns: z
      .array(z.string().trim().min(1).max(200).refine(expresionValida, 'Expresión regular no válida.'))
      .max(20)
      .optional(),
    steps: z.array(paso).max(10, 'Máximo 10 pasos.').optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    // Un `goto` solo puede ir al mismo host del panel (el agente lo exige; mejor avisar al guardar).
    let host: string;
    try {
      host = new URL(p.base_url).host;
    } catch {
      return;
    }
    (p.steps ?? []).forEach((s, i) =>
      s.actions.forEach((a, j) => {
        if (a.op === 'goto' && a.url && !a.url.includes('{') && new URL(a.url).host !== host) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', i, 'actions', j, 'url'],
            message: `El paso "${s.name}" va a otro sitio (${new URL(a.url).host}); solo se permite ${host}.`,
          });
        }
      }),
    );
  });

export const esquemaConfigRemota = z
  .object({ print: esquemaImpresion.optional(), panel: esquemaPanel.optional(), intervals: esquemaIntervalos.optional() })
  .strict();

export type ConfigRemota = z.infer<typeof esquemaConfigRemota>;

export const esquemaNombreAgente = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres.')
  .max(80, 'El nombre es demasiado largo (máximo 80).');

// ---------------------------------------------------------------------------
// Formulario <-> configuración
// ---------------------------------------------------------------------------

export type CamposFormularioAgente = {
  mode: string;
  print_copies: string;
  print_settings: string;
  heartbeat_seconds: string;
  claim_seconds: string;
  panel_retry_seconds: string;
  panel_base_url: string;
  panel_logged_in_selector: string;
  panel_logged_out_selectors: string;
  panel_challenge_selectors: string;
  panel_challenge_title_patterns: string;
  panel_steps: string;
};

export const CAMPOS_VACIOS: CamposFormularioAgente = {
  mode: 'api',
  print_copies: '',
  print_settings: '',
  heartbeat_seconds: '',
  claim_seconds: '',
  panel_retry_seconds: '',
  panel_base_url: '',
  panel_logged_in_selector: '',
  panel_logged_out_selectors: '',
  panel_challenge_selectors: '',
  panel_challenge_title_patterns: '',
  panel_steps: '',
};

function lineas(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function entero(texto: string): number | undefined | typeof Number.NaN {
  const t = texto.trim();
  if (t === '') return undefined;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Texto de los campos a partir de lo guardado, para rellenar el formulario. */
export function camposDesdeConfig(modo: string, remota: unknown): CamposFormularioAgente {
  const r = esObjeto(remota) ? remota : {};
  const print = esObjeto(r.print) ? r.print : {};
  const intervals = esObjeto(r.intervals) ? r.intervals : {};
  const panel = esObjeto(r.panel) ? r.panel : {};
  const num = (v: unknown) => (typeof v === 'number' ? String(v) : '');
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join('\n') : '');
  return {
    mode: modo === 'panel' ? 'panel' : 'api',
    print_copies: num(print.copies),
    print_settings: typeof print.print_settings === 'string' ? print.print_settings : '',
    heartbeat_seconds: num(intervals.heartbeat_seconds),
    claim_seconds: num(intervals.claim_seconds),
    panel_retry_seconds: num(intervals.panel_retry_seconds),
    panel_base_url: typeof panel.base_url === 'string' ? panel.base_url : '',
    panel_logged_in_selector: typeof panel.logged_in_selector === 'string' ? panel.logged_in_selector : '',
    panel_logged_out_selectors: lista(panel.logged_out_selectors),
    panel_challenge_selectors: lista(panel.challenge_selectors),
    panel_challenge_title_patterns: lista(panel.challenge_title_patterns),
    panel_steps: Array.isArray(panel.steps) && panel.steps.length > 0 ? JSON.stringify(panel.steps, null, 2) : '',
  };
}

export type ResultadoFormularioAgente =
  | { ok: true; modo: ModoAgente; config: ConfigRemota }
  | { ok: false; errores: Record<string, string> };

/** Mapa de la ruta del esquema al campo del formulario donde se muestra el error. */
function campoDeRuta(ruta: readonly PropertyKey[]): string {
  const [a, b] = ruta.map(String);
  if (a === 'print') return `print_${b === 'copies' ? 'copies' : 'settings'}`;
  if (a === 'intervals') return b ?? 'heartbeat_seconds';
  if (a === 'panel') {
    if (b === 'base_url') return 'panel_base_url';
    if (b === 'logged_in_selector') return 'panel_logged_in_selector';
    if (b === 'logged_out_selectors') return 'panel_logged_out_selectors';
    if (b === 'challenge_selectors') return 'panel_challenge_selectors';
    if (b === 'challenge_title_patterns') return 'panel_challenge_title_patterns';
    return 'panel_steps';
  }
  return 'form';
}

/** Convierte lo escrito en el formulario en `{ modo, config }` validado, o errores por campo. */
export function configDesdeFormulario(c: CamposFormularioAgente): ResultadoFormularioAgente {
  const errores: Record<string, string> = {};
  if (!(MODOS_AGENTE as readonly string[]).includes(c.mode)) errores.mode = 'Modo no válido.';

  const numeros: Record<string, number | undefined> = {};
  for (const clave of ['print_copies', 'heartbeat_seconds', 'claim_seconds', 'panel_retry_seconds'] as const) {
    const n = entero(c[clave]);
    if (Number.isNaN(n)) errores[clave] = 'Escribe un número entero.';
    else numeros[clave] = n;
  }

  let pasos: unknown;
  if (c.panel_steps.trim() !== '') {
    try {
      pasos = JSON.parse(c.panel_steps) as unknown;
    } catch {
      errores.panel_steps = 'El JSON de los pasos no es válido.';
    }
    if (pasos !== undefined && !Array.isArray(pasos)) errores.panel_steps = 'Los pasos deben ser una lista.';
  }

  const print: Record<string, unknown> = {};
  if (numeros.print_copies !== undefined) print.copies = numeros.print_copies;
  if (c.print_settings.trim() !== '') print.print_settings = c.print_settings;
  const intervals: Record<string, unknown> = {};
  for (const clave of ['heartbeat_seconds', 'claim_seconds', 'panel_retry_seconds'] as const) {
    if (numeros[clave] !== undefined) intervals[clave] = numeros[clave];
  }
  const hayPanel = [
    c.panel_base_url,
    c.panel_logged_in_selector,
    c.panel_logged_out_selectors,
    c.panel_challenge_selectors,
    c.panel_challenge_title_patterns,
    c.panel_steps,
  ].some((v) => v.trim() !== '');
  const panel: Record<string, unknown> = {};
  if (hayPanel) {
    panel.base_url = c.panel_base_url.trim();
    if (c.panel_logged_in_selector.trim() !== '') panel.logged_in_selector = c.panel_logged_in_selector.trim();
    for (const [campo, clave] of [
      ['panel_logged_out_selectors', 'logged_out_selectors'],
      ['panel_challenge_selectors', 'challenge_selectors'],
      ['panel_challenge_title_patterns', 'challenge_title_patterns'],
    ] as const) {
      const l = lineas(c[campo]);
      if (l.length > 0) panel[clave] = l;
    }
    if (Array.isArray(pasos)) panel.steps = pasos;
  }
  if (c.mode === 'panel' && !hayPanel) errores.panel_base_url = 'En modo panel hay que indicar la URL del panel de MasterShop.';

  const candidato: Record<string, unknown> = {};
  if (Object.keys(print).length > 0) candidato.print = print;
  if (Object.keys(intervals).length > 0) candidato.intervals = intervals;
  if (hayPanel) candidato.panel = panel;
  const r = esquemaConfigRemota.safeParse(candidato);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const campo = campoDeRuta(issue.path);
      const detalle = campo === 'panel_steps' && issue.path.length > 2 ? `Paso ${Number(issue.path[2]) + 1}: ${issue.message}` : issue.message;
      if (!(campo in errores)) errores[campo] = detalle;
    }
  }
  if (Object.keys(errores).length > 0 || !r.success) return { ok: false, errores };
  return { ok: true, modo: c.mode as ModoAgente, config: r.data };
}

/**
 * Nueva `remote_config`: reemplaza `print`, `panel` e `intervals` con lo editado y conserva cualquier otra clave
 * que ya estuviera guardada (para no borrar ajustes futuros que este formulario no conoce).
 */
export function mezclarConfigRemota(actual: unknown, editada: ConfigRemota): Record<string, unknown> {
  const base = esObjeto(actual) ? { ...actual } : {};
  delete base.print;
  delete base.panel;
  delete base.intervals;
  return { ...base, ...editada };
}
