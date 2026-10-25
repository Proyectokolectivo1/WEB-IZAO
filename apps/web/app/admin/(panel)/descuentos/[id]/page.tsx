import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioCodigo } from '@/components/admin/FormularioCodigo';
import { leerPais } from '@/components/admin/PestanasPais';
import { MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { CODIGO_NUEVO, ETIQUETA_ESTADO, aValoresCodigo, estadoCodigo } from '@/lib/admin/descuentos/codigos';
import {
  listarCategoriasOpciones,
  listarInfluencersOpciones,
  obtenerCodigo,
  reporteUsoCodigo,
  slugsDeProductos,
} from '@/lib/admin/descuentos/codigos-servidor';
import { dineroBig, fechaHoraBogota } from '@/lib/admin/formato';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { alternarCodigo, eliminarCodigo, guardarCodigo } from '../acciones';

export const metadata: Metadata = { title: 'Código de descuento' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETIQUETA_CANJE = { reserved: 'Reservados (pedido sin pagar)', confirmed: 'Confirmados', released: 'Liberados (pedido vencido o abandonado)' } as const;

export default async function EditarCodigo({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'descuentos' });
  const { id } = await params;
  const sp = await searchParams;
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const codigo = nuevo ? null : await obtenerCodigo(cliente, id);
  if (!nuevo && !codigo) notFound();

  const [categorias, influencers] = await Promise.all([listarCategoriasOpciones(cliente), listarInfluencersOpciones(cliente)]);
  const categoriaIds = new Set(categorias.map((c) => c.id));
  const slugs = codigo
    ? await slugsDeProductos(cliente, [...codigo.target_ids, ...codigo.exclude_ids].filter((i) => !categoriaIds.has(i)))
    : new Map<string, string>();
  const inicial = codigo ? aValoresCodigo(codigo, slugs, categoriaIds) : {
        ...CODIGO_NUEVO,
        country_code: leerPais(sp.pais),
        influencer_id: typeof sp.influencer === 'string' && UUID.test(sp.influencer) ? sp.influencer : '',
      };
  const uso = codigo ? await reporteUsoCodigo(cliente, codigo.id) : null;
  const moneda = MONEDA_PAIS[inicial.country_code];
  const estado = codigo ? estadoCodigo(codigo, new Date()) : null;
  const volverHref = `/admin/descuentos?pais=${inicial.country_code}`;

  return (
    <>
      <p className="adm-migas">
        <Link href={volverHref}>Descuentos</Link> / {codigo ? codigo.code : 'Nuevo'}
      </p>
      <h1>{codigo ? `Código ${codigo.code}` : 'Nuevo código'}</h1>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {codigo && estado ? (
        <p>
          <span className={`adm-insignia ${estado === 'vigente' ? 'adm-insignia-ok' : ''}`.trim()}>{ETIQUETA_ESTADO[estado]}</span>{' '}
          <span className="adm-suave">
            {codigo.usage_count} uso{codigo.usage_count === 1 ? '' : 's'} confirmado{codigo.usage_count === 1 ? '' : 's'} · creado el{' '}
            {fechaHoraBogota(codigo.created_at)}
          </span>
        </p>
      ) : null}

      <FormularioCodigo
        modo="codigo"
        inicial={inicial}
        categorias={categorias.map((c) => ({ id: c.id, etiqueta: c.name }))}
        influencers={influencers
          .filter((i) => i.is_active || i.id === inicial.influencer_id)
          .map((i) => ({ id: i.id, etiqueta: i.handle ? `${i.name} (@${i.handle})` : i.name, pais: i.country_code }))}
        accion={guardarCodigo}
        volverHref={volverHref}
      />

      {codigo && uso ? (
        <>
          <section aria-labelledby="h-uso">
            <h2 id="h-uso">Uso del código</h2>
            <ul className="adm-lista-simple">
              {(['confirmed', 'reserved', 'released'] as const).map((k) => (
                <li key={k}>
                  {ETIQUETA_CANJE[k]}: <strong>{uso.canjes[k].cantidad}</strong>
                  {uso.canjes[k].cantidad > 0 ? <span className="adm-suave"> · {dineroBig(uso.canjes[k].monto, moneda)} descontados</span> : null}
                </li>
              ))}
            </ul>
            {uso.recientes.length === 0 ? (
              <p className="adm-vacio">Este código aún no se ha usado.</p>
            ) : (
              <div className="adm-tabla-caja">
                <table className="adm-tabla">
                  <caption className="adm-suave">Últimos pedidos con este código</caption>
                  <thead>
                    <tr>
                      <th scope="col">Pedido</th>
                      <th scope="col">Canje</th>
                      <th scope="col">Descuento</th>
                      <th scope="col">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uso.recientes.map((r, i) => (
                      <tr key={`${r.numero ?? 'x'}-${i}`}>
                        <td>{r.numero ?? '—'}</td>
                        <td>{ETIQUETA_CANJE[r.estado].split(' (')[0]}</td>
                        <td>{dineroBig(r.monto, moneda)}</td>
                        <td>{fechaHoraBogota(r.fecha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="h-acciones">
            <h2 id="h-acciones">Acciones</h2>
            <div className="adm-acciones">
              <BotonConfirmar
                etiqueta={codigo.is_active ? 'Desactivar' : 'Activar'}
                mensaje={
                  codigo.is_active
                    ? 'El código deja de aplicarse en el carrito. Los pedidos ya creados no cambian.'
                    : 'El código vuelve a aplicarse en el carrito, dentro de su vigencia.'
                }
                etiquetaConfirmar={codigo.is_active ? 'Sí, desactivar' : 'Sí, activar'}
                peligro={codigo.is_active}
                accion={alternarCodigo.bind(null, codigo.id, !codigo.is_active)}
              />
              <BotonConfirmar
                etiqueta="Eliminar"
                mensaje="Se borra el código. Solo es posible si nunca se usó; si ya tiene pedidos, desactívalo."
                etiquetaConfirmar="Sí, eliminar"
                accion={eliminarCodigo.bind(null, codigo.id)}
              />
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
