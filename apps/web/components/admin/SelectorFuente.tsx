'use client';

import { useId, useState } from 'react';
import {
  CATEGORIAS_FUENTE,
  ETIQUETA_CATEGORIA_FUENTE,
  FUENTES_CATALOGO,
  fuentePorFamilia,
  pilaFuente,
  variableCssFuente,
  type CategoriaFuente,
  type FuenteCatalogo,
  type UsoFuente,
} from '@/lib/tipografia/catalogo';

/**
 * `font-family` de una fuente del catálogo usando la variable que declara `fuentes-previa.ts`.
 * Excepción documentada a «todo sigue las variables del tema»: es la MUESTRA de la fuente candidata (cada opción se ve en su propia cara).
 */
export function familiaCss(f: FuenteCatalogo): string {
  return `var(${variableCssFuente(f)}), ${pilaFuente(f)}`;
}

const MUESTRA: Record<UsoFuente, string> = {
  titulos: 'Una fragancia para cada momento',
  texto: 'Notas de bergamota, vainilla y madera. Envío a todo el país.',
};

/**
 * Selector de tipografía con vista previa de cada opción en su propia fuente. La lista (y por tanto la descarga de las
 * fuentes de muestra) solo se pinta cuando está abierta. El valor viaja en un campo oculto con el nombre de la familia
 * de Google Fonts; vacío = «hereda» (solo en un país). Teclado: Tab hasta la lista y flechas entre opciones.
 */
export function SelectorFuente({
  nombre,
  etiqueta,
  uso,
  valor,
  onCambio,
  heredada,
  error,
}: {
  nombre: string;
  etiqueta: string;
  uso: UsoFuente;
  valor: string;
  onCambio: (familia: string) => void;
  /** En un país: familia que se usa si queda vacío. Con este dato aparece la opción «La del sitio». */
  heredada?: string | undefined;
  error?: string | undefined;
}) {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState<CategoriaFuente | 'todas' | 'recomendadas'>('recomendadas');

  const actual = fuentePorFamilia(valor);
  const efectiva = actual ?? (heredada ? fuentePorFamilia(heredada) : null);
  const lista = FUENTES_CATALOGO.filter((f) =>
    filtro === 'todas' ? true : filtro === 'recomendadas' ? f.usos.includes(uso) : f.categoria === filtro,
  );
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div className="adm-campo fte">
      <input type="hidden" name={nombre} value={valor} />
      <span id={`${id}-etiqueta`} className="adm-etiqueta">
        {etiqueta}
      </span>
      <details
        className="fte-detalle"
        open={abierto}
        onToggle={(e) => setAbierto((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary aria-labelledby={`${id}-etiqueta ${id}-actual`} aria-describedby={describedBy}>
          <span id={`${id}-actual`} className="fte-actual">
            <span className="fte-nombre" style={efectiva ? { fontFamily: familiaCss(efectiva) } : undefined}>
              {actual ? actual.familia : heredada ? `La del sitio (${heredada})` : 'Elige una tipografía'}
            </span>
            {actual ? <span className="adm-suave adm-chico"> · {actual.caracter}</span> : null}
          </span>
        </summary>

        {abierto ? (
          <div className="fte-panel">
            <div className="fte-filtros" role="group" aria-label="Filtrar tipografías">
              {(
                [
                  ['recomendadas', uso === 'titulos' ? 'Para títulos' : 'Para texto'],
                  ['todas', 'Todas'],
                  ...CATEGORIAS_FUENTE.map((c) => [c, ETIQUETA_CATEGORIA_FUENTE[c]] as const),
                ] as const
              ).map(([clave, texto]) => (
                <button
                  key={clave}
                  type="button"
                  className="fte-chip"
                  aria-pressed={filtro === clave}
                  onClick={() => setFiltro(clave)}
                >
                  {texto}
                </button>
              ))}
            </div>
            <div className="fte-lista" role="radiogroup" aria-labelledby={`${id}-etiqueta`}>
              {heredada !== undefined ? (
                <label className="fte-opcion" data-activa={valor === '' ? 'si' : undefined}>
                  <input
                    type="radio"
                    name={`${id}-opcion`}
                    checked={valor === ''}
                    onChange={() => {
                      onCambio('');
                      setAbierto(false);
                    }}
                  />
                  <span className="fte-opcion-nombre">La del sitio ({heredada})</span>
                  <span className="adm-suave adm-chico">Este país usa la tipografía general.</span>
                </label>
              ) : null}
              {lista.map((f) => (
                <label key={f.id} className="fte-opcion" data-activa={valor === f.familia ? 'si' : undefined}>
                  <input
                    type="radio"
                    name={`${id}-opcion`}
                    checked={valor === f.familia}
                    onChange={() => {
                      onCambio(f.familia);
                      setAbierto(false);
                    }}
                  />
                  <span className="fte-opcion-nombre">
                    {f.familia} <span className="adm-suave adm-chico">· {f.caracter}</span>
                  </span>
                  <span
                    className={uso === 'titulos' ? 'fte-muestra fte-muestra-titulo' : 'fte-muestra'}
                    style={{ fontFamily: familiaCss(f) }}
                    aria-hidden="true"
                  >
                    {MUESTRA[uso]}
                  </span>
                </label>
              ))}
              {lista.length === 0 ? <p className="adm-suave">No hay tipografías en este grupo.</p> : null}
            </div>
          </div>
        ) : null}
      </details>
      {error ? (
        <p id={`${id}-error`} className="adm-error-campo">
          {error}
        </p>
      ) : null}
    </div>
  );
}
