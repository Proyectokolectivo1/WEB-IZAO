'use client';

import { IzaoImage } from '@izao/ui';
import type { LineaCarrito } from '@/lib/store/carrito/logica';
import type { ResumenCheckout } from '@/lib/store/checkout/logica';
import { TC } from '@/lib/store/textos-checkout';
import { useCarrito } from '../carrito/CarritoProvider';
import type { EstadoCodigo } from '../carrito/useVistaPrevia';
import { CodigoDescuento } from './CodigoDescuento';
import { Totales, type FilaTotal } from './Totales';

interface Props {
  lineas: readonly LineaCarrito[];
  resumen: ResumenCheckout;
  esContraEntrega: boolean;
  precio: (v: bigint | string) => string;
  codigo: EstadoCodigo | null;
  revisando: boolean;
  onAplicar: (t: string) => Promise<void>;
  onQuitar: () => void;
}

/** Resumen fijo del checkout: productos, descuento, cargo por financiación, envío, total y, en contra entrega, abono y saldo. */
export function ResumenPedido({ lineas, resumen, esContraEntrega, precio, codigo, revisando, onAplicar, onQuitar }: Props) {
  const { notaEnvio, valorEnvio } = useCarrito();
  const filas: FilaTotal[] = [{ clave: 'sub', etiqueta: TC.resumen.subtotal, valor: precio(resumen.subtotal) }];
  if (resumen.descuento > 0n) {
    filas.push({ clave: 'desc', etiqueta: TC.resumen.descuento, valor: `−${precio(resumen.descuento)}`, tono: 'positivo' });
  }
  if (resumen.recargo > 0n && resumen.recargoPct) {
    filas.push({ clave: 'rec', etiqueta: TC.resumen.recargo(resumen.recargoPct.replace('.', ',')), valor: precio(resumen.recargo) });
  }
  filas.push({ clave: 'envio', etiqueta: TC.resumen.envio, valor: valorEnvio });

  return (
    <div>
      <ul className="divide-y divide-line border-b border-line">
        {lineas.map((l) => (
          <li key={l.variantId} className="flex gap-4 py-4">
            <div className="relative w-16 shrink-0">
              <IzaoImage media={l.imagen} alt="" sizes="64px" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-display text-lg leading-tight">{l.nombre}</span>
              <span className="text-[0.875rem] text-ink/80">
                {[l.presentacion, TC.resumen.cantidad(l.cantidad)].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className="text-[0.9375rem] tabular-nums">{precio(BigInt(l.precio) * BigInt(l.cantidad))}</span>
          </li>
        ))}
      </ul>

      <div className="border-b border-line py-5">
        <CodigoDescuento
          id="codigo-checkout"
          codigo={codigo}
          revisando={revisando}
          onAplicar={onAplicar}
          onQuitar={onQuitar}
          aviso={resumen.codigoRetirado ? TC.checkout.codigosNoAplican : null}
        />
      </div>

      <div className="pt-5">
        <Totales filas={filas} total etiquetaTotal={TC.resumen.total} valorTotal={precio(resumen.total)} />
        {esContraEntrega ? (
          <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-[0.9375rem]">
            <div className="flex items-baseline justify-between gap-4">
              <dt>{TC.resumen.abono}</dt>
              <dd className="tabular-nums">{precio(resumen.abono)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt>{TC.resumen.pagasAlRecibir}</dt>
              <dd className="tabular-nums">{precio(resumen.recaudo)}</dd>
            </div>
          </dl>
        ) : null}
        <p className="pt-4 text-[0.875rem] text-ink/80">{notaEnvio}</p>
      </div>
    </div>
  );
}
