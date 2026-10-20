import Link from 'next/link';
import { TAMANO_PAGINA } from '@/lib/admin/crud/comun';

/** Paginación con enlaces (la página vive en la URL, funciona sin JavaScript). */
export function Paginacion({
  base,
  total,
  pagina,
  parametros = {},
}: {
  base: string;
  total: number;
  pagina: number;
  parametros?: Record<string, string>;
}) {
  const paginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const href = (p: number) => {
    const qs = new URLSearchParams(parametros);
    if (p > 1) qs.set('page', String(p));
    else qs.delete('page');
    const texto = qs.toString();
    return texto ? `${base}?${texto}` : base;
  };
  return (
    <nav className="adm-paginacion" aria-label="Paginación">
      <p className="adm-suave adm-chico">
        {total} resultado{total === 1 ? '' : 's'} · página {Math.min(pagina, paginas)} de {paginas}
      </p>
      <div className="adm-acciones">
        {pagina > 1 ? (
          <Link className="adm-enlace-boton adm-boton-secundario" href={href(pagina - 1)} rel="prev">
            Anterior
          </Link>
        ) : null}
        {pagina < paginas ? (
          <Link className="adm-enlace-boton adm-boton-secundario" href={href(pagina + 1)} rel="next">
            Siguiente
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
