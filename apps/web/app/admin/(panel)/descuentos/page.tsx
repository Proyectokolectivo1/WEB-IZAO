import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { PestanasPais } from '@/components/admin/PestanasPais';
import {
  ESTADOS_FILTRO,
  ETIQUETA_ESTADO,
  ETIQUETA_ORIGEN,
  ORIGENES,
  describirValor,
  estadoCodigo,
  leerFiltrosCodigos,
  parametrosCodigos,
} from '@/lib/admin/descuentos/codigos';
import { listarCodigos } from '@/lib/admin/descuentos/codigos-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Descuentos' };

export default async function ListaDescuentos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'descuentos' });
  const sp = await searchParams;
  const filtros = leerFiltrosCodigos(sp);
  const ahora = new Date();
  const { filas, total } = await listarCodigos(crearClienteServicio(), filtros, ahora);
  const lote = typeof sp.lote === 'string' ? Number.parseInt(sp.lote, 10) : 0;
  const conLote = filtros.origen === 'batch' && filtros.q !== '';
  const parametros = parametrosCodigos(filtros);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Descuentos</h1>
        <div className="adm-acciones">
          <Link href={`/admin/descuentos/lote?pais=${filtros.pais}`} className="adm-enlace-boton adm-boton-secundario">
            Generar lote
          </Link>
          <Link href={`/admin/descuentos/nuevo?pais=${filtros.pais}`} className="adm-enlace-boton">
            Nuevo código
          </Link>
        </div>
      </div>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Código eliminado.</p> : null}
      {lote > 0 ? (
        <p className="adm-ok" role="status">
          Se generaron {lote} códigos. Los ves abajo y puedes descargarlos.
        </p>
      ) : null}
      <p className="adm-suave">
        Un código por pedido, no acumulable y nunca con Addi ni Sistecrédito. Para ver los influencers y sus ventas, entra
        a <Link href="/admin/influencers">Influencers</Link>.
      </p>
      <PestanasPais base="/admin/descuentos" actual={filtros.pais} />

      <form className="adm-filtros" method="get" role="search" aria-label="Filtrar códigos">
        <input type="hidden" name="pais" value={filtros.pais} />
        <div className="adm-campo">
          <label htmlFor="f-q" className="adm-etiqueta">
            Código
          </label>
          <input id="f-q" name="q" className="adm-input" defaultValue={filtros.q} maxLength={30} autoComplete="off" />
        </div>
        <div className="adm-campo">
          <label htmlFor="f-estado" className="adm-etiqueta">
            Estado
          </label>
          <select id="f-estado" name="estado" className="adm-input" defaultValue={filtros.estado}>
            <option value="">Todos</option>
            {ESTADOS_FILTRO.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="f-origen" className="adm-etiqueta">
            Origen
          </label>
          <select id="f-origen" name="origen" className="adm-input" defaultValue={filtros.origen}>
            <option value="">Todos</option>
            {ORIGENES.map((o) => (
              <option key={o} value={o}>
                {ETIQUETA_ORIGEN[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-acciones">
          <button type="submit" className="adm-boton">
            Filtrar
          </button>
          <Link href={`/admin/descuentos?pais=${filtros.pais}`} className="adm-enlace-boton adm-boton-secundario">
            Limpiar
          </Link>
        </div>
      </form>

      {conLote ? (
        <p>
          <a
            className="adm-enlace-boton adm-boton-secundario"
            href={`/api/admin/descuentos/exportar?pais=${filtros.pais}&prefijo=${encodeURIComponent(filtros.q)}`}
          >
            Descargar el lote en Excel
          </a>
        </p>
      ) : null}

      {filas.length === 0 ? (
        <p className="adm-vacio">
          {filtros.q || filtros.estado || filtros.origen ? (
            <>No hay códigos con esos filtros.</>
          ) : (
            <>
              Aún no hay códigos para este país. <Link href={`/admin/descuentos/nuevo?pais=${filtros.pais}`}>Crear el primero</Link>
            </>
          )}
        </p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla">
            <caption className="adm-suave">Códigos de descuento</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descuento</th>
                <th scope="col">Estado</th>
                <th scope="col">Usos</th>
                <th scope="col">Origen</th>
                <th scope="col">Iza</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const estado = estadoCodigo(f, ahora);
                return (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/admin/descuentos/${f.id}`}>{f.code}</Link>
                    </td>
                    <td>{describirValor(f)}</td>
                    <td>
                      <span className={`adm-insignia ${estado === 'vigente' ? 'adm-insignia-ok' : estado === 'programado' ? 'adm-insignia-aviso' : ''}`.trim()}>
                        {ETIQUETA_ESTADO[estado]}
                      </span>
                    </td>
                    <td>
                      {f.usage_count}
                      {f.usage_limit_total !== null ? ` / ${f.usage_limit_total}` : ''}
                    </td>
                    <td>{ETIQUETA_ORIGEN[f.origin]}</td>
                    <td>{f.iza_can_offer ? 'Sí' : 'No'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/descuentos" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
