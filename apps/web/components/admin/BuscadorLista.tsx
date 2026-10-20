/** Búsqueda por GET: el término queda en la URL (compartible y sin JavaScript). */
export function BuscadorLista({
  q,
  etiqueta = 'Buscar',
  ocultos = {},
  limpiarHref,
}: {
  q: string;
  etiqueta?: string;
  ocultos?: Record<string, string>;
  limpiarHref: string;
}) {
  return (
    <form className="adm-busqueda" role="search" method="get">
      {Object.entries(ocultos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="adm-campo">
        <label htmlFor="q" className="adm-etiqueta">
          {etiqueta}
        </label>
        <input id="q" name="q" type="search" className="adm-input" defaultValue={q} maxLength={100} />
      </div>
      <button type="submit" className="adm-boton">
        Buscar
      </button>
      {q ? (
        <a className="adm-enlace-boton adm-boton-secundario" href={limpiarHref}>
          Limpiar
        </a>
      ) : null}
    </form>
  );
}
