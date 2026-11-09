'use client';

import { useActionState, useMemo, useState } from 'react';
import { CLAVES_COLOR, PARES_TIPOGRAFICOS, type ClaveColor } from '@izao/ui/tema';
import { descripcionPesos, fuentePorFamilia, pesoDisponible } from '@/lib/tipografia/catalogo';
import {
  ETIQUETA_COLOR,
  PESOS_TITULOS,
  coloresEfectivos,
  contrastesDe,
  fallosGraves,
  normalizarHex,
  type Alcance,
} from '@/lib/admin/apariencia/apariencia';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';
import { SelectorFuente, familiaCss } from './SelectorFuente';
import { SelectorImagen, type ImagenInicial } from './SelectorImagen';

export type ValoresApariencia = {
  /** Valor propio del alcance; vacío en un país = hereda. */
  colores: Record<ClaveColor, string>;
  /** Familia de Google Fonts del catálogo; vacío en un país = hereda. */
  heading_font: string;
  body_font: string;
  base_size_px: string;
  heading_weight: string;
  heading_letter_spacing: string;
  label_letter_spacing: string;
  store_name: string;
};

const nombreCampo = (k: ClaveColor) => `color_${k.replace('-', '_')}`;

/**
 * Editor de apariencia con vista previa en vivo y contraste calculado. El servidor vuelve a validar todo y
 * bloquea el guardado si el texto de cuerpo baja de 4.5:1 sin que la persona haya aceptado la advertencia.
 */
export function FormularioApariencia({
  alcance,
  inicial,
  heredados,
  logo,
  favicon,
  accion,
}: {
  alcance: Alcance;
  inicial: ValoresApariencia;
  /** Colores y tipografía que el país hereda del global (en el global, los de fábrica). */
  heredados: { colores: Record<ClaveColor, string>; titulos: string; texto: string; base: number; peso: number; espTitulos: string; espEtiquetas: string };
  logo: ImagenInicial;
  favicon: ImagenInicial;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const global = alcance === 'global';
  const [colores, setColores] = useState(inicial.colores);
  const [titulos, setTitulos] = useState(inicial.heading_font);
  const [texto, setTexto] = useState(inicial.body_font);
  const [base, setBase] = useState(inicial.base_size_px);
  const [peso, setPeso] = useState(inicial.heading_weight);
  const [espT, setEspT] = useState(inicial.heading_letter_spacing);
  const [espE, setEspE] = useState(inicial.label_letter_spacing);

  const efectivos = useMemo(() => {
    const capa: Partial<Record<ClaveColor, string | null>> = {};
    for (const k of CLAVES_COLOR) capa[k] = normalizarHex(colores[k]);
    return coloresEfectivos(heredados.colores, capa);
  }, [colores, heredados.colores]);
  const contrastes = useMemo(() => contrastesDe(efectivos), [efectivos]);
  const graves = fallosGraves(contrastes);

  const fuenteTitulos = fuentePorFamilia(titulos) ?? fuentePorFamilia(heredados.titulos);
  const fuenteTexto = fuentePorFamilia(texto) ?? fuentePorFamilia(heredados.texto);
  const pesoNum = Number(peso) || heredados.peso;
  const pesoReal = fuenteTitulos ? pesoDisponible(fuenteTitulos, pesoNum) : pesoNum;
  const baseNum = Number(base) || heredados.base;
  const vista = {
    '--color-bg': efectivos.bg,
    '--color-surface': efectivos.surface,
    '--color-accent': efectivos.accent,
    '--color-muted': efectivos.muted,
    '--color-ink': efectivos.ink,
    '--color-ink-hover': efectivos['ink-hover'],
    '--color-success': efectivos.success,
    '--color-danger': efectivos.danger,
    '--prev-display': fuenteTitulos ? familiaCss(fuenteTitulos) : 'var(--font-display)',
    '--prev-body': fuenteTexto ? familiaCss(fuenteTexto) : 'var(--font-body)',
    '--prev-base': `${Math.min(18, Math.max(15, baseNum))}px`,
    '--prev-peso': String(pesoReal),
    '--prev-esp-t': /^-?\d{1,2}(\.\d{1,3})?em$/.test(espT) ? espT : heredados.espTitulos,
    '--prev-esp-e': /^-?\d{1,2}(\.\d{1,3})?em$/.test(espE) ? espE : heredados.espEtiquetas,
  } as React.CSSProperties;

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      <input type="hidden" name="alcance" value={alcance} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      {global ? null : (
        <p className="adm-aviso">Deja un campo vacío para que este país use el valor del sitio. Solo se guarda lo que cambies.</p>
      )}

      <fieldset className="adm-fieldset">
        <legend>Colores</legend>
        <div className="apar-colores">
          {CLAVES_COLOR.map((k) => {
            const valor = colores[k];
            const hex = normalizarHex(valor) ?? efectivos[k];
            return (
              <div key={k} className="apar-color">
                <input
                  type="color"
                  aria-label={`Elegir ${ETIQUETA_COLOR[k].nombre}`}
                  value={hex.length === 7 ? hex : '#000000'}
                  onChange={(e) => setColores((c) => ({ ...c, [k]: e.target.value.toUpperCase() }))}
                />
                <CampoTexto
                  id={nombreCampo(k)}
                  name={nombreCampo(k)}
                  etiqueta={ETIQUETA_COLOR[k].nombre}
                  value={valor}
                  onChange={(e) => setColores((c) => ({ ...c, [k]: e.target.value }))}
                  placeholder={global ? '#382E2B' : heredados.colores[k]}
                  maxLength={7}
                  autoComplete="off"
                  spellCheck={false}
                  ayuda={ETIQUETA_COLOR[k].uso}
                  error={errores[nombreCampo(k)]}
                />
              </div>
            );
          })}
        </div>
      </fieldset>

      <section aria-labelledby="h-contraste">
        <h3 id="h-contraste">Contraste de lectura</h3>
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-visualmente-oculto">Contraste de cada combinación de texto</caption>
            <thead>
              <tr>
                <th scope="col">Combinación</th>
                <th scope="col">Contraste</th>
                <th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {contrastes.map((c) => (
                <tr key={c.descripcion}>
                  <td>
                    <span className="apar-muestra" style={{ background: c.fondo, color: c.texto }} aria-hidden="true">
                      Aa
                    </span>{' '}
                    {c.descripcion}
                  </td>
                  <td data-etiqueta="Contraste">{c.ratio.toFixed(2)}:1</td>
                  <td data-etiqueta="Resultado">
                    {c.uso === 'decorativo' ? (
                      <span className="adm-insignia">Solo decorativo</span>
                    ) : c.cumple && !c.advertencia ? (
                      <span className="adm-insignia adm-insignia-ok">Cumple AA</span>
                    ) : c.cumple ? (
                      <span className="adm-insignia adm-insignia-aviso">Solo texto grande (18 px o más)</span>
                    ) : (
                      <span className="adm-insignia adm-insignia-aviso">No cumple</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {graves.length > 0 ? (
          <div className="adm-alerta" role="alert">
            <p>
              {graves.length} combinación(es) de texto de cuerpo están por debajo de 4.5:1: se leerán con dificultad. Lo
              recomendable es corregir los colores.
            </p>
            <label className="adm-check">
              <input type="checkbox" name="acepto_contraste" />
              Entiendo la advertencia y quiero guardar de todos modos
            </label>
            {errores.acepto_contraste ? <p className="adm-error-campo">{errores.acepto_contraste}</p> : null}
          </div>
        ) : null}
      </section>

      <fieldset className="adm-fieldset">
        <legend>Tipografía</legend>
        <div className="adm-campo">
          <label htmlFor="pareja-sugerida" className="adm-etiqueta">
            Pareja sugerida (atajo)
          </label>
          <select
            id="pareja-sugerida"
            className="adm-input"
            value={PARES_TIPOGRAFICOS.find((p) => p.titulos === titulos && p.texto === texto)?.id ?? ''}
            onChange={(e) => {
              const par = PARES_TIPOGRAFICOS.find((p) => String(p.id) === e.target.value);
              if (!par) return;
              setTitulos(par.titulos);
              setTexto(par.texto);
            }}
          >
            <option value="">Combinación propia (elige abajo)</option>
            {PARES_TIPOGRAFICOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}. {p.titulos} + {p.texto} — {p.caracter}
              </option>
            ))}
          </select>
          <p className="adm-suave adm-chico">Rellena las dos tipografías de una vez; después puedes cambiar cualquiera.</p>
        </div>
        <div className="fte-dos">
          <SelectorFuente
            nombre="heading_font"
            etiqueta="Tipografía de los títulos"
            uso="titulos"
            valor={titulos}
            onCambio={setTitulos}
            heredada={global ? undefined : heredados.titulos}
            error={errores.heading_font}
          />
          <SelectorFuente
            nombre="body_font"
            etiqueta="Tipografía del texto"
            uso="texto"
            valor={texto}
            onCambio={setTexto}
            heredada={global ? undefined : heredados.texto}
            error={errores.body_font}
          />
        </div>
        {fuenteTitulos ? (
          <p className="adm-suave adm-chico">
            Pesos de «{fuenteTitulos.familia}»: {descripcionPesos(fuenteTitulos)}.
            {pesoReal !== pesoNum ? ` El peso ${pesoNum} no existe en esta fuente: la tienda usará ${pesoReal}.` : ''}
          </p>
        ) : null}
        <div className="adm-fila">
          <CampoTexto id="base_size_px" name="base_size_px" etiqueta="Tamaño base (15 a 18 px)" inputMode="numeric" value={base} onChange={(e) => setBase(e.target.value)} error={errores.base_size_px} />
          <CampoSelect
            id="heading_weight"
            name="heading_weight"
            etiqueta="Peso de los títulos"
            vacio={global ? undefined : 'El del sitio'}
            opciones={PESOS_TITULOS.map((p) => ({ valor: String(p), etiqueta: String(p) }))}
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            error={errores.heading_weight}
          />
        </div>
        <div className="adm-fila">
          <CampoTexto id="heading_letter_spacing" name="heading_letter_spacing" etiqueta="Espaciado de títulos (em)" value={espT} onChange={(e) => setEspT(e.target.value)} placeholder="0em" error={errores.heading_letter_spacing} />
          <CampoTexto id="label_letter_spacing" name="label_letter_spacing" etiqueta="Espaciado de etiquetas (em)" value={espE} onChange={(e) => setEspE(e.target.value)} placeholder="0.14em" error={errores.label_letter_spacing} />
        </div>
      </fieldset>

      {global ? (
        <fieldset className="adm-fieldset">
          <legend>Marca</legend>
          <CampoTexto id="store_name" name="store_name" etiqueta="Nombre de la tienda" defaultValue={inicial.store_name} maxLength={80} error={errores.store_name} />
          <SelectorImagen nombre="logo_media_id" etiqueta="Logo" kind="site" inicial={logo} error={errores.logo_media_id} />
          <SelectorImagen nombre="favicon_media_id" etiqueta="Favicon" kind="site" inicial={favicon} error={errores.favicon_media_id} />
        </fieldset>
      ) : null}

      <section aria-labelledby="h-previa">
        <h3 id="h-previa">Vista previa en vivo</h3>
        <div className="apar-previa" style={vista}>
          <p className="apar-previa-etiqueta">Nueva colección</p>
          <p className="apar-previa-titulo">Una fragancia para cada momento</p>
          <p className="apar-previa-texto">
            Notas de bergamota, vainilla y madera. Envío a todo el país y pago contra entrega en ciudades habilitadas.
          </p>
          <p className="apar-previa-fila">
            <span className="apar-previa-boton">Agregar al carrito</span>
            <span className="apar-previa-secundario">Ver detalle</span>
            <span className="apar-previa-chip">Disponible</span>
          </p>
          <p className="apar-previa-fila apar-previa-estados">
            <span style={{ color: 'var(--color-success)' }}>En stock</span>
            <span style={{ color: 'var(--color-danger)' }}>Agotado</span>
            <span style={{ color: 'var(--color-muted)', fontSize: '1.125rem' }}>Texto secundario grande</span>
          </p>
        </div>
      </section>

      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar apariencia'}
        </button>
      </div>
    </form>
  );
}
