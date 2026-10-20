'use client';

import { useState } from 'react';
import type { ReporteImagenes, ReporteImportacion } from '@/lib/admin/catalogo/importacion-servidor';

type Fase = 'inicio' | 'procesando' | 'simulado' | 'aplicado';

/** Subir -> simulación con reporte -> confirmar. La confirmación vuelve a enviar el mismo archivo. */
export function ImportadorCatalogo() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [fase, setFase] = useState<Fase>('inicio');
  const [reporte, setReporte] = useState<ReporteImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enviar(modo: 'simular' | 'aplicar') {
    if (!archivo) return;
    setError(null);
    setFase('procesando');
    try {
      const datos = new FormData();
      datos.set('archivo', archivo);
      datos.set('modo', modo);
      const r = await fetch('/api/admin/catalogo/importar', { method: 'POST', body: datos });
      const cuerpo = (await r.json().catch(() => ({}))) as Partial<ReporteImportacion> & { error?: string };
      if (!r.ok || cuerpo.error) {
        setError(cuerpo.error ?? 'No se pudo procesar el archivo.');
        setFase(modo === 'aplicar' ? 'simulado' : 'inicio');
        return;
      }
      setReporte(cuerpo as ReporteImportacion);
      setFase(modo === 'simular' ? 'simulado' : 'aplicado');
    } catch {
      setError('No se pudo procesar el archivo. Revisa tu conexión.');
      setFase(modo === 'aplicar' ? 'simulado' : 'inicio');
    }
  }

  const ocupado = fase === 'procesando';
  const aplicables = reporte ? reporte.creados + reporte.actualizados + reporte.sin_cambios : 0;
  return (
    <section className="adm-fieldset" aria-labelledby="imp-titulo">
      <h2 id="imp-titulo">Importar productos</h2>
      <div className="adm-campo">
        <label htmlFor="imp-archivo" className="adm-etiqueta">
          Archivo CSV o Excel (.xlsx)
        </label>
        <input
          id="imp-archivo"
          type="file"
          accept=".csv,.txt,.xlsx"
          disabled={ocupado}
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setReporte(null);
            setFase('inicio');
            setError(null);
          }}
        />
      </div>
      <div className="adm-acciones">
        <button type="button" className="adm-boton" disabled={!archivo || ocupado} onClick={() => void enviar('simular')}>
          {ocupado ? 'Procesando…' : 'Simular importación'}
        </button>
        {fase === 'simulado' && reporte && reporte.productos > 0 ? (
          <button type="button" className="adm-boton adm-boton-peligro" disabled={ocupado} onClick={() => void enviar('aplicar')}>
            Confirmar e importar {reporte.productos} producto{reporte.productos === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="adm-error-campo" role="alert">
          {error}
        </p>
      ) : null}
      {reporte ? (
        <div role="status" aria-live="polite">
          <h3>{fase === 'aplicado' ? 'Importación aplicada' : 'Simulación (no se guardó nada)'}</h3>
          <ul>
            <li>Productos nuevos: {reporte.creados}</li>
            <li>Productos que se actualizan: {reporte.actualizados}</li>
            <li>Sin cambios: {reporte.sin_cambios}</li>
            <li>Omitidos por errores: {reporte.omitidos}</li>
            {reporte.ignoradas.length ? <li>Columnas ignoradas: {reporte.ignoradas.join(', ')}</li> : null}
          </ul>
          {fase === 'simulado' && aplicables === 0 ? <p className="adm-alerta">No hay nada para importar. Corrige los errores y vuelve a simular.</p> : null}
          {reporte.errores.length > 0 ? (
            <div className="adm-tabla-caja">
              <table className="adm-tabla">
                <caption>Errores ({reporte.errores.length}). Los productos con error no se importan.</caption>
                <thead>
                  <tr>
                    <th scope="col">Fila</th>
                    <th scope="col">SKU</th>
                    <th scope="col">Columna</th>
                    <th scope="col">Problema</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.errores.slice(0, 300).map((e, i) => (
                    <tr key={i}>
                      <td>{e.fila ?? '-'}</td>
                      <td>{e.sku ?? '-'}</td>
                      <td>{e.columna ?? '-'}</td>
                      <td>{e.mensaje}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {reporte.cambios.length > 0 ? (
            <details>
              <summary>Cambios por producto ({reporte.cambios.length})</summary>
              <ul>
                {reporte.cambios.slice(0, 300).map((c) => (
                  <li key={c.slug}>
                    <strong>{c.slug}</strong>: {c.tipo === 'crear' ? 'se crea' : 'se actualiza'}
                    {c.campos.length ? ` (${c.campos.join(', ')})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Imágenes masivas: `SKU_1.jpg` (principal), `SKU_2.jpg` (cursor), `SKU_3.jpg`... o un .zip. Se envían en tandas. */
export function CargaImagenesPorSku() {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [avance, setAvance] = useState('');
  const [reporte, setReporte] = useState<ReporteImagenes | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subir() {
    setTrabajando(true);
    setError(null);
    const total: ReporteImagenes = { asignadas: [], errores: [] };
    const zips = archivos.filter((f) => f.name.toLowerCase().endsWith('.zip'));
    const sueltas = archivos.filter((f) => !f.name.toLowerCase().endsWith('.zip'));
    const tandas: File[][] = [...zips.map((z) => [z]), ...Array.from({ length: Math.ceil(sueltas.length / 8) }, (_, i) => sueltas.slice(i * 8, i * 8 + 8))];
    try {
      for (let i = 0; i < tandas.length; i += 1) {
        setAvance(`Tanda ${i + 1} de ${tandas.length}…`);
        const datos = new FormData();
        for (const f of tandas[i] as File[]) datos.append('archivos', f);
        const r = await fetch('/api/admin/catalogo/imagenes', { method: 'POST', body: datos });
        const cuerpo = (await r.json().catch(() => ({}))) as Partial<ReporteImagenes> & { error?: string };
        if (!r.ok || cuerpo.error) {
          setError(cuerpo.error ?? 'No se pudo subir una tanda de imágenes.');
          break;
        }
        total.asignadas.push(...(cuerpo.asignadas ?? []));
        total.errores.push(...(cuerpo.errores ?? []));
      }
    } catch {
      setError('No se pudieron subir las imágenes. Revisa tu conexión.');
    } finally {
      setReporte(total);
      setTrabajando(false);
      setAvance('');
    }
  }

  return (
    <section className="adm-fieldset" aria-labelledby="img-titulo">
      <h2 id="img-titulo">Carga masiva de imágenes por SKU</h2>
      <p className="adm-suave adm-chico">
        Nombra cada archivo con el SKU, un guion bajo y la posición: <code>AVT-100_1.jpg</code> es la principal, <code>_2</code> la de cursor y <code>_3</code> en adelante la galería. También puedes subir un .zip. Las imágenes anteriores de esas posiciones se reemplazan.
      </p>
      <div className="adm-campo">
        <label htmlFor="img-archivos" className="adm-etiqueta">
          Imágenes (JPG, PNG o WebP) o .zip
        </label>
        <input
          id="img-archivos"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,.zip"
          disabled={trabajando}
          onChange={(e) => {
            setArchivos(Array.from(e.target.files ?? []));
            setReporte(null);
          }}
        />
      </div>
      <div className="adm-acciones">
        <button type="button" className="adm-boton" disabled={archivos.length === 0 || trabajando} onClick={() => void subir()}>
          {trabajando ? avance || 'Subiendo…' : `Subir ${archivos.length} archivo${archivos.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {error ? (
        <p className="adm-error-campo" role="alert">
          {error}
        </p>
      ) : null}
      {reporte ? (
        <div role="status" aria-live="polite">
          <p>
            Asignadas: {reporte.asignadas.length}. Con problemas: {reporte.errores.length}.
          </p>
          {reporte.errores.length > 0 ? (
            <ul>
              {reporte.errores.slice(0, 200).map((e, i) => (
                <li key={i}>
                  <strong>{e.archivo}</strong>: {e.mensaje}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
