/**
 * Máquina de estados del pedido (§16, D-002).
 *
 * Funciones puras: validan la transición y devuelven el evento que se escribe en
 * `order_events`. El `transitionOrder(orderId, to, actor, payload)` del servidor
 * (con `select … for update`) debe usar `transicionar` y no cambiar `orders.status`
 * por otro camino.
 */

/** Los 17 estados, en el mismo orden que el `check` de `orders.status`. */
export const ORDER_STATUSES = [
  'pendiente_pago',
  'pago_rechazado',
  'expirado',
  'esperando_abono',
  'abandonado',
  'pendiente_manual',
  'pagado',
  'abono_pagado',
  'error_transportadora',
  'enviado_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'cancelado',
  'reclamacion',
  'requiere_reembolso',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Transiciones válidas. Fuente: tabla de §16, más:
 * - D-002: `pendiente_manual → expirado` al vencer la reserva.
 * - §12.2: abono aprobado tarde para un pedido `abandonado` sin stock →
 *   `requiere_reembolso` (§16 lo describe como "pago tardío sin stock").
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    pendiente_pago: ['pagado', 'pago_rechazado', 'expirado'],
    pago_rechazado: ['pendiente_pago', 'expirado'],
    expirado: [],
    esperando_abono: ['abono_pagado', 'abandonado'],
    abandonado: ['abono_pagado', 'requiere_reembolso'],
    pendiente_manual: ['pagado', 'cancelado', 'expirado'],
    pagado: ['enviado_transportadora', 'error_transportadora'],
    abono_pagado: ['enviado_transportadora', 'error_transportadora'],
    error_transportadora: ['enviado_transportadora'],
    enviado_transportadora: ['en_preparacion', 'cancelado'],
    en_preparacion: ['en_transito'],
    en_transito: ['entregado', 'devuelto', 'reclamacion'],
    entregado: ['reclamacion'],
    devuelto: [],
    cancelado: [],
    reclamacion: [],
    requiere_reembolso: ['cancelado'],
  });

export const TERMINAL_STATUSES: readonly OrderStatus[] = Object.freeze(
  ORDER_STATUSES.filter((s) => ORDER_TRANSITIONS[s].length === 0),
);

const STATUS_SET: ReadonlySet<string> = new Set(ORDER_STATUSES);

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

export function isTerminal(status: OrderStatus): boolean {
  return isOrderStatus(status) && ORDER_TRANSITIONS[status].length === 0;
}

export function siguientesEstados(from: OrderStatus): readonly OrderStatus[] {
  return isOrderStatus(from) ? ORDER_TRANSITIONS[from] : [];
}

export function puedeTransicionar(from: OrderStatus, to: OrderStatus): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false;
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Actor de `order_events`: mismo patrón que el `check` de la base. */
export type OrderActor = 'system' | 'agent' | `admin:${string}` | `webhook:${string}`;

const ACTOR_RE = /^(system|agent|admin:.+|webhook:.+)$/;

export function isValidActor(actor: string): actor is OrderActor {
  return ACTOR_RE.test(actor);
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Fila a insertar en `order_events` (sin `order_id`, que pone el servidor). */
export interface OrderStatusEvent {
  readonly type: 'status_changed';
  readonly from_status: OrderStatus;
  readonly to_status: OrderStatus;
  readonly actor: OrderActor;
  readonly payload: Readonly<Record<string, JsonValue>>;
}

export type TransitionErrorCode =
  | 'UNKNOWN_STATUS'
  | 'SAME_STATE'
  | 'TERMINAL_STATE'
  | 'INVALID_TRANSITION'
  | 'INVALID_ACTOR';

export interface TransitionError {
  readonly code: TransitionErrorCode;
  readonly message: string;
}

export type TransitionResult =
  | { readonly ok: true; readonly event: OrderStatusEvent }
  | { readonly ok: false; readonly error: TransitionError };

export interface TransitionInput {
  from: OrderStatus;
  to: OrderStatus;
  actor: string;
  payload?: Record<string, JsonValue>;
}

function fail(code: TransitionErrorCode, message: string): TransitionResult {
  return { ok: false, error: { code, message } };
}

export function transicionar(input: TransitionInput): TransitionResult {
  const { from, to, actor } = input;
  if (!isOrderStatus(from) || !isOrderStatus(to)) {
    return fail('UNKNOWN_STATUS', `Estado desconocido: ${String(from)} → ${String(to)}.`);
  }
  if (!isValidActor(actor)) {
    return fail('INVALID_ACTOR', `Actor inválido para order_events: "${actor}".`);
  }
  if (from === to) {
    return fail('SAME_STATE', `El pedido ya está en ${from}.`);
  }
  if (isTerminal(from)) {
    return fail('TERMINAL_STATE', `El estado ${from} es final y no admite cambios.`);
  }
  if (!puedeTransicionar(from, to)) {
    return fail('INVALID_TRANSITION', `Transición no permitida: ${from} → ${to}.`);
  }
  return {
    ok: true,
    event: Object.freeze({
      type: 'status_changed',
      from_status: from,
      to_status: to,
      actor,
      payload: Object.freeze({ ...(input.payload ?? {}) }),
    }),
  };
}

/**
 * Camino más corto de transiciones válidas de `from` a `to` (sin incluir `from`).
 * Sirve a la sincronización con la transportadora cuando el polling se salta
 * estados intermedios: se registra cada paso con `transicionar`. `null` si no hay camino.
 */
export function findTransitionPath(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  if (!isOrderStatus(from) || !isOrderStatus(to) || from === to) return null;
  const prev = new Map<OrderStatus, OrderStatus>();
  const queue: OrderStatus[] = [from];
  const seen = new Set<OrderStatus>([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of ORDER_TRANSITIONS[current]) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, current);
      if (next === to) {
        const path: OrderStatus[] = [to];
        let step = current;
        while (step !== from) {
          path.unshift(step);
          step = prev.get(step)!;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
