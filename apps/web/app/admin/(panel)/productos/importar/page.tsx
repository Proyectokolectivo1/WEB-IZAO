import type { Metadata } from 'next';
import Link from 'next/link';
import { CargaImagenesPorSku, ImportadorCatalogo } from '@/components/admin/ImportadorCatalogo';
import { COLUMNAS } from '@/lib/admin/catalogo/importacion';
import { requerirAdmin } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Importar y exportar productos' };

export default async function ImportarProductos() {
  await requerirAdmin({ modulo: 'productos' });
  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/productos">Productos</Link> / Importar y exportar
      </p>
      <h1>Importar y exportar productos</h1>

      <section className="adm-fieldset adm-ancho-total" aria-labelledby="desc-titulo">
        <h2 id="desc-titulo">Plantilla y exportación</h2>
        <p>
          Una fila por variante. Las filas con el mismo <code>producto_slug</code> forman un producto. Una celda vacía no cambia el dato
          existente. Los precios se escriben en la moneda del país (COP sin decimales, USD con hasta dos) y sin símbolos. Las categorías van separadas por{' '}
          <code>|</code>. Las marcas, géneros, familias, concentraciones y categorías deben existir antes.
        </p>
        <div className="adm-acciones">
          <a className="adm-enlace-boton adm-boton-secundario" href="/api/admin/catalogo/plantilla?formato=xlsx">
            Plantilla Excel
          </a>
          <a className="adm-enlace-boton adm-boton-secundario" href="/api/admin/catalogo/plantilla?formato=csv">
            Plantilla CSV
          </a>
          <a className="adm-enlace-boton" href="/api/admin/catalogo/exportar?formato=xlsx">
            Exportar catálogo (Excel)
          </a>
          <a className="adm-enlace-boton" href="/api/admin/catalogo/exportar?formato=csv">
            Exportar catálogo (CSV)
          </a>
        </div>
        <details>
          <summary>Columnas ({COLUMNAS.length})</summary>
          <p className="adm-suave adm-chico">
            <code>{COLUMNAS.join(', ')}</code>. Valores sí/no en <code>visible_co</code>, <code>visible_ec</code> y <code>por_defecto</code>. Estado: borrador, activo o archivado.
          </p>
        </details>
      </section>

      <div className="adm-form-ancho" style={{ display: 'grid', gap: '1.5rem', marginTop: '1.5rem' }}>
        <ImportadorCatalogo />
        <CargaImagenesPorSku />
      </div>
    </>
  );
}
