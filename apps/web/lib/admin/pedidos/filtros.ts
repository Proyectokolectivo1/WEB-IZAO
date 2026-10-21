/**
 * Filtros de la lista de pedidos (§24.1) leídos de la URL. Función pura: valores desconocidos se ignoran en vez
 * de fallar, y las fechas se interpretan en hora de Colombia/Ecuador (UTC-5 todo el año, sin horario de verano).
 */
import { ORDER_STATUSES } from '@izao/core/order-state';

export const METODOS_PEDIDO = ['wompi', 'addi', 'sistecredito', 'cod', 'manual'] as const;
export const PAISES_PEDIDO = ['CO', 'EC'] as const;

export type FiltrosPedido = {
  q: string;
  pagina: number;
  estado: string;
  pais: string;
  metodo: string;
  /** `YYYY-MM-DD` (inclusive) o vacío. */
  desde: string;
  hasta: string;
};

type Buscables = Record<string, string | string[] | undefined>;

function primero(v: string | string[] | undefined): string {
  return ((Array.isArray(v) ? v[0] : v) ?? '').trim();
}

/** `2026-02-30` no es una fecha: se compara al volver a formatear. */
export function fechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

export function leerFiltrosPedido(sp: Buscables): FiltrosPedido {
  const estado = primero(sp.estado);
  const pais = primero(sp.pais).toUpperCase();
  const metodo = primero(sp.metodo);
  let desde = primero(sp.desde);
  let hasta = primero(sp.hasta);
  if (!fechaValida(desde)) desde = '';
  if (!fechaValida(hasta)) hasta = '';
  // Rango invertido: se intercambia en vez de devolver una lista vacía sin explicación.
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    q: primero(sp.q).slice(0, 100),
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    estado: (ORDER_STATUSES as readonly string[]).includes(estado) ? estado : '',
    pais: (PAISES_PEDIDO as readonly string[]).includes(pais) ? pais : '',
    metodo: (METODOS_PEDIDO as readonly string[]).includes(metodo) ? metodo : '',
    desde,
    hasta,
  };
}

/** Parámetros no vacíos, para conservar los filtros al paginar. */
export function parametrosDeFiltros(f: FiltrosPedido): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const clave of ['q', 'estado', 'pais', 'metodo', 'desde', 'hasta'] as const) {
    if (f[clave]) salida[clave] = f[clave];
  }
  return salida;
}

/** Inicio del día (inclusive) y del día siguiente (exclusivo) en UTC-5, como ISO. */
export function rangoFechasUtc(f: Pick<FiltrosPedido, 'desde' | 'hasta'>): { desde?: string; hasta?: string } {
  const salida: { desde?: string; hasta?: string } = {};
  if (f.desde) salida.desde = new Date(`${f.desde}T00:00:00-05:00`).toISOString();
  if (f.hasta) {
    const fin = new Date(`${f.hasta}T00:00:00-05:00`);
    fin.setUTCDate(fin.getUTCDate() + 1);
    salida.hasta = fin.toISOString();
  }
  return salida;
}

export type BusquedaPedido = { campo: 'contact_phone_e164' | 'number'; patron: string } | null;

/**
 * Un texto con 7 o más dígitos (y solo dígitos, espacios, guiones o `+`) es un teléfono; cualquier otro se busca
 * en el número de pedido. Los números de pedido tienen 6 dígitos de secuencia, así que no chocan.
 */
export function interpretarBusqueda(q: string): BusquedaPedido {
  const t = q.trim();
  if (!t) return null;
  if (/^\+?[\d\s-]+$/.test(t)) {
    const digitos = t.replace(/\D/g, '');
    if (digitos.length >= 7) return { campo: 'contact_phone_e164', patron: digitos };
  }
  return { campo: 'number', patron: t };
}
