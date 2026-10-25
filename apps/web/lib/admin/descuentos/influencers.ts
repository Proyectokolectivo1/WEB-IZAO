/**
 * Influencers (§17.2, §24.1): validación de la ficha, enlace de referido y reporte por rango de fechas. El reporte
 * usa las definiciones de §21.2 de `@izao/core/metrics` (pagado, ingreso confirmado); la comisión se calcula con
 * `percentOfHundredths` de `@izao/core/money`, sin floats. Código puro.
 */
import { z } from 'zod';
import { esPagado, ingresoConfirmado, type PedidoMetrica } from '@izao/core/metrics';
import { MoneyError, money, percentOfHundredths, roundHalfUpDiv, type CurrencyCode } from '@izao/core/money';
import { afirmaOriginalidad } from '../pagos/ajustes';

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export type DatosInfluencer = {
  id?: string | undefined;
  name: string;
  handle: string | null;
  country_code: 'CO' | 'EC';
  phone: string | null;
  email: string | null;
  /** Centésimas de porcentaje (12,50 % → 1250) o `null` si no tiene comisión. */
  commission_hundredths: number | null;
  notes: string | null;
  is_active: boolean;
};

/** `12,5` o `12.50` → `1250` centésimas; `null` si no es un porcentaje de 0 a 100 con máximo 2 decimales. */
export function porcentajeACentesimas(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const entero = Number(m[1]);
  const dec = Number((m[2] ?? '').padEnd(2, '0'));
  const total = entero * 100 + dec;
  return total > 10000 ? null : total;
}

/** `1250` → `12.5` (para el formulario y la base `numeric(5,2)`). */
export function centesimasATexto(c: number): string {
  const entero = Math.floor(c / 100);
  const dec = String(c % 100).padStart(2, '0').replace(/0$/, '');
  return dec === '' || dec === '0' ? String(entero) : `${entero}.${dec}`;
}

export const esquemaInfluencer = z
  .object({
    id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
    name: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(80, 'Máximo 80 caracteres.'),
    handle: z.string().trim().max(60, 'Máximo 60 caracteres.').default(''),
    country_code: z.enum(['CO', 'EC'], { message: 'Elige el país.' }),
    phone: z.string().trim().max(30).default(''),
    email: z.string().trim().max(120).default(''),
    commission_pct: z.string().default(''),
    notes: z.string().trim().max(500, 'Máximo 500 caracteres.').default(''),
    is_active: casilla,
  })
  .superRefine((d, ctx) => {
    if (d.phone !== '' && !/^\+?[0-9 ()-]{7,20}$/.test(d.phone)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Escribe un teléfono válido (solo números, +, espacios o guiones).' });
    }
    if (d.email !== '' && !z.string().email().safeParse(d.email).success) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Escribe un correo válido.' });
    }
    if (d.commission_pct.trim() !== '' && porcentajeACentesimas(d.commission_pct) === null) {
      ctx.addIssue({ code: 'custom', path: ['commission_pct'], message: 'La comisión debe estar entre 0 y 100, con máximo 2 decimales.' });
    }
    if (afirmaOriginalidad(d.notes)) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Ese texto afirma originalidad o certificados; no está permitido.' });
    }
  })
  .transform(
    (d): DatosInfluencer => ({
      id: d.id,
      name: d.name,
      handle: d.handle.replace(/^@+/, '') || null,
      country_code: d.country_code,
      phone: d.phone || null,
      email: d.email ? d.email.toLowerCase() : null,
      commission_hundredths: d.commission_pct.trim() === '' ? null : porcentajeACentesimas(d.commission_pct),
      notes: d.notes || null,
      is_active: d.is_active,
    }),
  );

/** Enlace de referido de §17.2: `/{pais}?ref=CODIGO` (la cookie de 30 días y el código automático los pone la tienda). */
export function enlaceReferido(origen: string, pais: 'CO' | 'EC', codigo: string): string {
  const base = origen.replace(/\/+$/, '');
  return `${base}/${pais.toLowerCase()}?ref=${encodeURIComponent(codigo)}`;
}

// ── Reporte ──────────────────────────────────────────────────────────────────────────────────────

export type PedidoInfluencer = { influencerId: string; pedido: PedidoMetrica };

export type FilaReporteInfluencer = {
  influencerId: string;
  moneda: CurrencyCode;
  pedidos: number;
  pedidosPagados: number;
  ventasBrutas: bigint;
  entregados: number;
  devueltos: number;
  ingresosConfirmados: bigint;
  /** Ventas brutas / pedidos pagados (redondeo half-up); `null` sin pedidos pagados. */
  ticketPromedio: bigint | null;
  /** `commission_pct` × ingresos confirmados; `null` si el influencer no tiene comisión. */
  comision: bigint | null;
};

/**
 * Agrupa por influencer. Un influencer pertenece a un país, así que todos sus pedidos comparten moneda; si llega
 * un pedido de otra moneda se rechaza (no se mezclan monedas).
 * `comisiones` trae las centésimas de porcentaje por influencer.
 */
export function reportePorInfluencer(
  pedidos: readonly PedidoInfluencer[],
  comisiones: ReadonlyMap<string, number | null>,
): FilaReporteInfluencer[] {
  const grupos = new Map<string, FilaReporteInfluencer>();
  for (const { influencerId, pedido: p } of pedidos) {
    let g = grupos.get(influencerId);
    if (!g) {
      g = {
        influencerId,
        moneda: p.moneda,
        pedidos: 0,
        pedidosPagados: 0,
        ventasBrutas: 0n,
        entregados: 0,
        devueltos: 0,
        ingresosConfirmados: 0n,
        ticketPromedio: null,
        comision: null,
      };
      grupos.set(influencerId, g);
    }
    if (g.moneda !== p.moneda) throw new MoneyError('CURRENCY_MISMATCH', `Pedidos de varias monedas para ${influencerId}.`);
    g.pedidos += 1;
    if (esPagado(p.estado)) {
      g.pedidosPagados += 1;
      g.ventasBrutas += p.total;
    }
    if (p.estado === 'entregado') g.entregados += 1;
    if (p.estado === 'devuelto') g.devueltos += 1;
    g.ingresosConfirmados += ingresoConfirmado(p);
  }
  for (const g of grupos.values()) {
    if (g.pedidosPagados > 0) {

      g.ticketPromedio = roundHalfUpDiv(g.ventasBrutas, BigInt(g.pedidosPagados));
    }
    const c = comisiones.get(g.influencerId) ?? null;
    g.comision = c === null ? null : percentOfHundredths(money(g.ingresosConfirmados, g.moneda), BigInt(c)).amount;
  }
  return [...grupos.values()].sort((a, b) => (a.ventasBrutas === b.ventasBrutas ? 0 : a.ventasBrutas > b.ventasBrutas ? -1 : 1));
}

