/**
 * Clientes (§24.1, §26.2): filtros de la lista, interpretación de la búsqueda y reglas de la anonimización por
 * habeas data. Código puro compartido por Server Actions y pruebas.
 *
 * Anonimizar borra o neutraliza los datos personales pero conserva lo que la contabilidad necesita (montos, fechas,
 * estado, ciudad y departamento del pedido). Un cliente con pedidos o garantías en curso no se anonimiza: la
 * transportadora y el servicio todavía necesitan sus datos.
 */
import { z } from 'zod';

export const ESTADOS_CLIENTE = ['activos', 'anonimizados'] as const;
export type EstadoCliente = (typeof ESTADOS_CLIENTE)[number];

export type FiltrosCliente = {
  q: string;
  pagina: number;
  pais: 'CO' | 'EC' | '';
  /** Vacío = todos. */
  estado: EstadoCliente | '';
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export function leerFiltrosCliente(sp: Buscables): FiltrosCliente {
  const pais = primero(sp.pais).toUpperCase();
  const estado = primero(sp.estado);
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    q: primero(sp.q).slice(0, 100),
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    pais: pais === 'CO' || pais === 'EC' ? pais : '',
    estado: (ESTADOS_CLIENTE as readonly string[]).includes(estado) ? (estado as EstadoCliente) : '',
  };
}

export function parametrosDeFiltrosCliente(f: FiltrosCliente): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const k of ['q', 'pais', 'estado'] as const) if (f[k]) salida[k] = f[k];
  return salida;
}

export type BusquedaCliente = { campo: 'email' | 'phone_e164' | 'document_number' | 'nombre'; patron: string };

/** `@` = correo; 7+ dígitos con `+`, espacios o guiones = celular; solo dígitos de 5 a 6 = documento; otro = nombre. */
export function interpretarBusquedaCliente(q: string): BusquedaCliente | null {
  const t = q.trim();
  if (!t) return null;
  if (t.includes('@')) return { campo: 'email', patron: t.toLowerCase() };
  if (/^\+?[\d\s-]+$/.test(t)) {
    const digitos = t.replace(/\D/g, '');
    if (digitos.length >= 7) return { campo: 'phone_e164', patron: digitos };
    if (digitos.length >= 4) return { campo: 'document_number', patron: digitos };
  }
  return { campo: 'nombre', patron: t };
}

export function nombreDeCliente(c: { first_name: string | null; last_name: string | null; anonymized_at?: string | null }): string {
  if (c.anonymized_at) return 'Cliente anonimizado';
  const n = [c.first_name, c.last_name].filter((x) => x && x.trim() !== '').join(' ');
  return n || 'Sin nombre';
}

// ── Anonimización ────────────────────────────────────────────────────────────────────────────────

/** Estados de pedido que ya no necesitan los datos del cliente. El resto está "en curso". */
export const ESTADOS_PEDIDO_CERRADOS = ['entregado', 'devuelto', 'cancelado', 'expirado', 'abandonado', 'pago_rechazado'] as const;
/** Garantías que siguen abiertas. */
export const ESTADOS_GARANTIA_ABIERTOS = ['recibida', 'en_revision', 'aprobada'] as const;

export function pedidoEnCurso(estado: string): boolean {
  return !(ESTADOS_PEDIDO_CERRADOS as readonly string[]).includes(estado);
}

export const PALABRA_CONFIRMACION = 'ANONIMIZAR';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DatosAnonimizar = { id: string; motivo: string };

export const esquemaAnonimizar = z.object({
  id: z.string().regex(UUID, 'Identificador no válido.'),
  confirmacion: z.string().trim().refine((v) => v === PALABRA_CONFIRMACION, `Escribe ${PALABRA_CONFIRMACION} para confirmar.`),
  motivo: z
    .string()
    .trim()
    .min(5, 'Anota el número de radicado o la fecha de la solicitud (sin datos personales de la persona).')
    .max(300, 'Máximo 300 caracteres.'),
}).transform(({ id, motivo }): DatosAnonimizar => ({ id, motivo })) as unknown as z.ZodType<DatosAnonimizar, unknown>;

/** Qué impide anonimizar, en palabras para la persona. Vacío = se puede. */
export function bloqueosAnonimizacion(args: {
  yaAnonimizado: boolean;
  pedidosEnCurso: number;
  garantiasAbiertas: number;
  esCuentaDelPanel: boolean;
}): string[] {
  const m: string[] = [];
  if (args.yaAnonimizado) m.push('Este cliente ya fue anonimizado.');
  if (args.esCuentaDelPanel) m.push('Esta persona tiene una cuenta del panel: no se puede anonimizar desde aquí.');
  if (args.pedidosEnCurso > 0) m.push(`Tiene ${args.pedidosEnCurso} pedido(s) en curso: espera a que terminen o cancélalos.`);
  if (args.garantiasAbiertas > 0) m.push(`Tiene ${args.garantiasAbiertas} garantía(s) abierta(s): ciérralas primero.`);
  return m;
}
