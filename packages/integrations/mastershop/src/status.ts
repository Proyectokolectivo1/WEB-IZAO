/**
 * Estados de MasterShop (§14.6) → estados internos (§16) y grupos del dashboard (§21.3).
 *
 * La API numera 1–6 y 8–11 (el 7 no existe). El listado (`POST /api/orders/list`)
 * no trae el id sino `orderStatus` (nombre del filtro) y `statusParent`; el webhook trae
 * `id_status`. Por eso se resuelve por id o por nombre.
 */
import { findTransitionPath } from '@izao/core/order-state';
import type { OrderStatus } from '@izao/core/order-state';

export type MasterShopStatusId = 1 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11;

/** `statusParent` de MasterShop y grupos del panel de pedidos por estado de guía. */
export const MASTERSHOP_STATUS_GROUPS = [
  'Por preparar',
  'En preparación',
  'En tránsito',
  'Finalizadas',
] as const;
export type MasterShopStatusGroup = (typeof MASTERSHOP_STATUS_GROUPS)[number];

export interface MasterShopStatusInfo {
  id: MasterShopStatusId;
  /** Nombre del estado en la tabla de la documentación. */
  name: string;
  /** Nombre que usa el filtro `orderStatus` del listado. */
  filterName: string;
  /**
   * `statusParent` según la colección de Postman (observado el 2026-10-02): 1-2 Por
   * preparar, 3-5 En preparación, 6 En tránsito, 8-11 Finalizadas. Difiere de §14.6
   * (5 en tránsito, 11 sin grupo): gana el proveedor. La plataforma lo define y no es
   * contrato: si el listado trae `statusParent`, ese valor manda.
   */
  group: MasterShopStatusGroup;
  internal: OrderStatus;
  /** Ya salió de "Por Confirmar" (§14.6 marca el 2 como confirmado). */
  confirmed: boolean;
  /** No cambiará más: el polling deja de consultarlo. */
  final: boolean;
}

export const MASTERSHOP_STATUSES: readonly MasterShopStatusInfo[] = Object.freeze([
  s(1, 'Por confirmar', 'Por Confirmar', 'Por preparar', 'enviado_transportadora', false, false),
  s(2, 'Pendiente', 'Pendiente', 'Por preparar', 'enviado_transportadora', true, false),
  s(3, 'Por alistar', 'Por Alistar', 'En preparación', 'en_preparacion', true, false),
  s(4, 'Por recolectar', 'Por Recolectar', 'En preparación', 'en_preparacion', true, false),
  s(5, 'Recolectada', 'Recolectada', 'En preparación', 'en_transito', true, false),
  s(6, 'En tránsito', 'En tránsito', 'En tránsito', 'en_transito', true, false),
  s(8, 'Entregada', 'Entregada', 'Finalizadas', 'entregado', true, true),
  s(9, 'Cancelada', 'Cancelada', 'Finalizadas', 'cancelado', false, true),
  s(10, 'Devuelta', 'Devuelta', 'Finalizadas', 'devuelto', true, true),
  s(11, 'Reclamaciones', 'Reclamaciones', 'Finalizadas', 'reclamacion', true, true),
]);

function s(
  id: MasterShopStatusId,
  name: string,
  filterName: string,
  group: MasterShopStatusGroup,
  internal: OrderStatus,
  confirmed: boolean,
  final: boolean,
): MasterShopStatusInfo {
  return Object.freeze({ id, name, filterName, group, internal, confirmed, final });
}

const BY_ID = new Map<number, MasterShopStatusInfo>(MASTERSHOP_STATUSES.map((x) => [x.id, x]));

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const BY_NAME = new Map<string, MasterShopStatusInfo>();
for (const x of MASTERSHOP_STATUSES) {
  BY_NAME.set(normalizeName(x.name), x);
  BY_NAME.set(normalizeName(x.filterName), x);
}

export function getMasterShopStatus(id: number): MasterShopStatusInfo | null {
  return BY_ID.get(id) ?? null;
}

export function masterShopStatusFromName(name: string): MasterShopStatusInfo | null {
  return BY_NAME.get(normalizeName(name)) ?? null;
}

/** Resuelve por id (número o texto de dígitos) y, si no hay, por nombre. */
export function resolveMasterShopStatus(ref: {
  id?: number | string | null;
  name?: string | null;
}): MasterShopStatusInfo | null {
  const raw = ref.id;
  if (raw !== null && raw !== undefined) {
    const id = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
    if (typeof id === 'number') return getMasterShopStatus(id);
  }
  if (typeof ref.name === 'string') return masterShopStatusFromName(ref.name);
  return null;
}

// ---------------------------------------------------------------------------
// Novedad
// ---------------------------------------------------------------------------

export interface MasterShopAlert {
  idAlert: number | null;
  name: string | null;
  type: string | null;
}

export interface NoveltyBadge {
  /** Mostrar la insignia "Novedad" en el panel. */
  show: boolean;
  alerts: MasterShopAlert[];
}

/** `hasNovelty` y `alerts` del listado de MasterShop → insignia del panel. */
export function noveltyBadge(input: { hasNovelty?: unknown; alerts?: unknown }): NoveltyBadge {
  const alerts: MasterShopAlert[] = Array.isArray(input.alerts)
    ? input.alerts
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
        .map((a) => ({
          idAlert: typeof a.idAlert === 'number' ? a.idAlert : null,
          name: typeof a.name === 'string' ? a.name : null,
          type: typeof a.type === 'string' ? a.type : null,
        }))
    : [];
  return { show: input.hasNovelty === true || alerts.length > 0, alerts };
}

// ---------------------------------------------------------------------------
// Transición interna
// ---------------------------------------------------------------------------

export type InternalTransitionPlan =
  | { kind: 'sin_cambio' }
  | { kind: 'transicion'; target: OrderStatus; path: OrderStatus[] }
  /** El estado de MasterShop no se alcanza desde el actual (atrasado o fuera de orden). */
  | { kind: 'no_aplicable'; target: OrderStatus }
  | { kind: 'desconocido' };

/**
 * Qué transiciones internas aplicar al sincronizar. Si el polling se saltó estados,
 * `path` los incluye todos para registrarlos con `transicionar` uno por uno.
 */
export function planInternalTransition(
  current: OrderStatus,
  statusId: number,
): InternalTransitionPlan {
  const info = getMasterShopStatus(statusId);
  if (info === null) return { kind: 'desconocido' };
  if (info.internal === current) return { kind: 'sin_cambio' };
  const path = findTransitionPath(current, info.internal);
  if (path === null) return { kind: 'no_aplicable', target: info.internal };
  return { kind: 'transicion', target: info.internal, path };
}
