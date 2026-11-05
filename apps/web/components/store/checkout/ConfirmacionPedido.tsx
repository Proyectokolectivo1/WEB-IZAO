import Link from 'next/link';
import { Icono, clasesBoton } from '@izao/ui';
import type { PedidoPublico } from '@/lib/store/checkout-datos';
import { enlaceWhatsapp } from '@/lib/store/contacto';
import { formatearFecha, formatearPrecio } from '@/lib/store/pais';
import { TC } from '@/lib/store/textos-checkout';
import { T } from '@/lib/store/textos';
import { RefrescarEstado } from './RefrescarEstado';
import { Totales, type FilaTotal } from './Totales';

const ESTADOS_EN_ESPERA = new Set(['pendiente_pago', 'esperando_abono', 'pago_rechazado']);

interface Props {
  pedido: PedidoPublico;
  whatsappAsesor: string | null;
  /** Valor de la fila «Envío» que define el panel (espacio `valor_envio`). */
  valorEnvio?: string;
}

/** Página de estado del pedido (`/{pais}/pedido/{public_token}`, §10.2): sin sesión, con línea de tiempo y pago pendiente. */
export function ConfirmacionPedido({ pedido, whatsappAsesor, valorEnvio }: Props) {
  const pais = pedido.pais;
  const precio = (v: string | bigint) => formatearPrecio(v, pais);
  const fecha = (iso: string | null) => (iso ? formatearFecha(iso, pais, { dateStyle: 'long', timeStyle: 'short' }) : null);
  const esContraEntrega = pedido.metodo === 'cod';
  const titulo = TC.pedido.titulos[pedido.estado] ?? TC.pedido.titulos.pendiente_pago;
  const texto = TC.pedido.textos[pedido.estado] ?? '';

  const pasos = [
    { clave: 'recibido', etiqueta: TC.pedido.pasos.recibido, fecha: pedido.creado, hecho: true },
    { clave: 'pago', etiqueta: TC.pedido.pasos.pago, fecha: pedido.pagado, hecho: Boolean(pedido.pagado) },
    { clave: 'enviado', etiqueta: TC.pedido.pasos.enviado, fecha: pedido.enviado, hecho: Boolean(pedido.enviado) },
    { clave: 'entregado', etiqueta: TC.pedido.pasos.entregado, fecha: pedido.entregado, hecho: Boolean(pedido.entregado) },
  ];
  const actual = pasos.findLastIndex((p) => p.hecho);

  const filas: FilaTotal[] = [{ clave: 'sub', etiqueta: TC.resumen.subtotal, valor: precio(pedido.subtotal) }];
  if (BigInt(pedido.descuento) > 0n) filas.push({ clave: 'desc', etiqueta: TC.resumen.descuento, valor: `−${precio(pedido.descuento)}`, tono: 'positivo' });
  if (BigInt(pedido.recargo) > 0n) {
    filas.push({
      clave: 'rec',
      etiqueta: pedido.recargoPct ? TC.resumen.recargo(pedido.recargoPct.replace('.', ',')) : TC.resumen.subtotal,
      valor: precio(pedido.recargo),
    });
  }
  filas.push({ clave: 'envio', etiqueta: TC.resumen.envio, valor: valorEnvio ?? T.carrito.envioGratis });

  const mensajeWa = TC.pedido.whatsappMensaje(
    pedido.numero,
    pedido.lineas.map((l) => `• ${l.cantidad} × ${l.nombre}${l.presentacion ? ` (${l.presentacion})` : ''}`),
    precio(pedido.total),
  );
  const enlaceWa = enlaceWhatsapp(whatsappAsesor, mensajeWa);
  // El abono pasa siempre por el link de marca (cuenta el clic y valida la vigencia); el resto va directo a la pasarela.
  const pago = pedido.pagoPendiente?.proposito === 'cod_deposit' ? null : pedido.pagoPendiente;
  const enlaceAbono = pedido.estado === 'esperando_abono' && pedido.tokenAbono ? `/${pais}/pagar/${pedido.tokenAbono}` : null;

  return (
    <article className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16">
      <RefrescarEstado activo={ESTADOS_EN_ESPERA.has(pedido.estado)} />
      <div>
        <p className="etiqueta pb-3">{TC.pedido.numero(pedido.numero)}</p>
        <h1 className="text-4xl md:text-5xl">{titulo}</h1>
        {texto ? <p className="max-w-xl pt-4 text-lg text-ink/90">{texto}</p> : null}

        <div className="flex flex-wrap gap-3 pt-8">
          {enlaceAbono ? (
            <a href={enlaceAbono} data-testid="pagar-abono" className={clasesBoton({ tamano: 'lg' })}>
              {TC.pedido.pagarAbono}
            </a>
          ) : null}
          {pago ? (
            <a href={pago.url} className={clasesBoton({ tamano: 'lg' })}>
              {TC.pedido.continuarPago}
            </a>
          ) : null}
          {pedido.estado === 'pendiente_manual' && enlaceWa ? (
            <a href={enlaceWa} target="_blank" rel="noopener" className={clasesBoton({ tamano: 'lg' })}>
              <Icono nombre="chat" />
              {TC.pedido.abrirWhatsapp}
              <span className="solo-lectores"> {TC.checkout.terminos.nuevaPestana}</span>
            </a>
          ) : null}
          <Link href={`/${pais}/catalogo`} className={clasesBoton({ variante: 'secundario', tamano: 'lg' })}>
            {T.carrito.seguirComprando}
          </Link>
        </div>

        <section aria-labelledby="linea-tiempo" className="mt-14 border-t border-ink pt-5">
          <h2 id="linea-tiempo" className="text-3xl">
            {TC.pedido.lineaTiempo}
          </h2>
          <ol className="mt-6 flex flex-col gap-0">
            {pasos.map((p, i) => (
              <li key={p.clave} aria-current={i === actual ? 'step' : undefined} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${p.hecho ? 'border-ink bg-ink text-bg' : 'border-line'}`}
                  >
                    {p.hecho ? <Icono nombre="check" tamano={16} /> : null}
                  </span>
                  {i < pasos.length - 1 ? <span className={`w-px grow ${pasos[i + 1]?.hecho ? 'bg-ink' : 'bg-line'}`} style={{ minHeight: '2rem' }} /> : null}
                </div>
                <div className="pb-6">
                  <p className={p.hecho ? 'font-semibold' : 'text-ink/80'}>
                    {p.etiqueta}
                    {i === actual ? <span className="solo-lectores"> · {TC.pedido.pasoActual}</span> : null}
                  </p>
                  {p.fecha ? <p className="text-[0.875rem] text-ink/80">{fecha(p.fecha)}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="h-fit lg:sticky lg:top-28" aria-labelledby="resumen-pedido">
        <div className="rounded-card border border-line p-6">
          <p id="resumen-pedido" className="etiqueta pb-4">
            {TC.pedido.resumen}
          </p>
          <ul className="divide-y divide-line border-b border-line">
            {pedido.lineas.map((l, i) => (
              <li key={`${l.nombre}-${i}`} className="flex justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block font-display text-lg leading-tight">{l.nombre}</span>
                  <span className="text-[0.875rem] text-ink/80">
                    {[l.presentacion, TC.resumen.cantidad(l.cantidad)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="text-[0.9375rem] tabular-nums">{precio(BigInt(l.precio) * BigInt(l.cantidad))}</span>
              </li>
            ))}
          </ul>
          <div className="pt-4">
            <Totales filas={filas} total etiquetaTotal={TC.resumen.total} valorTotal={precio(pedido.total)} />
            {esContraEntrega ? (
              <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-[0.9375rem]">
                <div className="flex justify-between gap-4">
                  <dt>{TC.resumen.abono}</dt>
                  <dd className="tabular-nums">{precio(pedido.abono)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>{TC.resumen.pagasAlRecibir}</dt>
                  <dd className="tabular-nums">{precio(pedido.recaudo)}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="mt-6 border-t border-line pt-4 text-[0.9375rem]">
            <p className="etiqueta pb-2">{TC.pedido.entrega}</p>
            <p>{[pedido.direccion, pedido.ciudad, pedido.region].filter(Boolean).join(', ')}</p>
            <p className="etiqueta pb-2 pt-4">{TC.pedido.pago}</p>
            <p>{TC.pedido.metodo[pedido.metodo] ?? pedido.metodo}</p>
          </div>
        </div>
      </aside>
    </article>
  );
}
