import type { Metadata } from 'next';
import Link from 'next/link';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioApariencia, type ValoresApariencia } from '@/components/admin/FormularioApariencia';
import { COLORES_POR_DEFECTO, CLAVES_COLOR, resolverColores, resolverTipografia, TIPOGRAFIA_POR_DEFECTO, type ClaveColor } from '@izao/ui/tema';
import { ALCANCES, ETIQUETA_ALCANCE, leerAlcance } from '@/lib/admin/apariencia/apariencia';
import { leerApariencia } from '@/lib/admin/apariencia/servidor';
import { fuentePorFamilia, resolverFuentes } from '@/lib/tipografia/catalogo';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { FormularioAjustesMedia } from '@/components/admin/FormularioAjustesMedia';
import { leerAjustesMedia } from '@/lib/admin/media/ajustes-servidor';
import { guardarAjustesMedia, guardarApariencia, quitarAjustesPais } from './acciones';

export const metadata: Metadata = { title: 'Apariencia' };

const texto = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export default async function PaginaApariencia({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'apariencia', accion: 'apariencia.gestionar' });
  const sp = await searchParams;
  const alcance = leerAlcance(sp.alcance);
  const pais = alcance === 'global' ? null : alcance;
  const [a, media] = await Promise.all([leerApariencia(crearClienteServicio(), pais), leerAjustesMedia()]);

  const globalColores = resolverColores(a.colorTokens).colores;
  const globalTipo = resolverTipografia(a.typography);
  const globalFuentes = resolverFuentes(a.typography);
  const fabrica = resolverFuentes(null);

  // Global: se edita lo guardado y lo "heredado" es lo de fábrica. País: se edita solo su override.
  const coloresPropios = resolverColores(a.override).colores;
  const overrideTipo = (a.override['typography'] ?? {}) as Record<string, unknown>;
  const inicialColores =
    alcance === 'global'
      ? globalColores
      : (Object.fromEntries(
          CLAVES_COLOR.map((k) => [k, a.override[`color-${k}`] !== undefined ? coloresPropios[k] : '']),
        ) as Record<ClaveColor, string>);

  const inicial: ValoresApariencia =
    alcance === 'global'
      ? {
          colores: inicialColores,
          heading_font: globalFuentes.titulos.familia,
          body_font: globalFuentes.texto.familia,
          base_size_px: String(globalTipo.baseSizePx),
          heading_weight: String(globalTipo.pesoTitulos),
          heading_letter_spacing: globalTipo.espaciadoTitulos,
          label_letter_spacing: globalTipo.espaciadoEtiquetas,
          store_name: a.storeName,
        }
      : {
          colores: inicialColores,
          heading_font: fuentePorFamilia(overrideTipo['heading_font'])?.familia ?? '',
          body_font: fuentePorFamilia(overrideTipo['body_font'])?.familia ?? '',
          base_size_px: texto(overrideTipo['base_size_px']),
          heading_weight: texto(overrideTipo['heading_weight']),
          heading_letter_spacing: texto(overrideTipo['heading_letter_spacing']),
          label_letter_spacing: texto(overrideTipo['label_letter_spacing']),
          store_name: '',
        };
  const heredados =
    alcance === 'global'
      ? {
          colores: { ...COLORES_POR_DEFECTO },
          titulos: fabrica.titulos.familia,
          texto: fabrica.texto.familia,
          base: TIPOGRAFIA_POR_DEFECTO.baseSizePx,
          peso: TIPOGRAFIA_POR_DEFECTO.pesoTitulos,
          espTitulos: TIPOGRAFIA_POR_DEFECTO.espaciadoTitulos,
          espEtiquetas: TIPOGRAFIA_POR_DEFECTO.espaciadoEtiquetas,
        }
      : {
          colores: globalColores,
          titulos: globalFuentes.titulos.familia,
          texto: globalFuentes.texto.familia,
          base: globalTipo.baseSizePx,
          peso: globalTipo.pesoTitulos,
          espTitulos: globalTipo.espaciadoTitulos,
          espEtiquetas: globalTipo.espaciadoEtiquetas,
        };
  const tieneOverride = Object.keys(a.override).length > 0;

  return (
    <>
      <h1>Apariencia</h1>
      <p className="adm-suave">
        Colores, tipografías, logo y favicon de la tienda. Los cambios se ven en la tienda en pocos minutos. Cada país puede
        tener ajustes propios sobre los del sitio.
      </p>
      {sp.guardado ? <p className="adm-ok" role="status">Apariencia guardada.</p> : null}
      {sp.restablecido ? <p className="adm-ok" role="status">El país vuelve a usar los ajustes del sitio.</p> : null}

      <ul className="adm-pestanas" aria-label="Alcance">
        {ALCANCES.map((x) => (
          <li key={x}>
            <Link href={`/admin/apariencia?alcance=${x}`} aria-current={x === alcance ? 'page' : undefined}>
              {ETIQUETA_ALCANCE[x]}
            </Link>
          </li>
        ))}
      </ul>

      <FormularioApariencia
        key={alcance}
        alcance={alcance}
        inicial={inicial}
        heredados={heredados}
        logo={a.logo}
        favicon={a.favicon}
        accion={guardarApariencia}
      />

      {alcance === 'global' ? (
        <section aria-labelledby="h-imagenes" className="adm-pila">
          <h2 id="h-imagenes">Imágenes</h2>
          <FormularioAjustesMedia inicial={media.ajustes} disponible={media.disponible} accion={guardarAjustesMedia} />
        </section>
      ) : null}

      {pais && tieneOverride ? (
        <section aria-labelledby="h-quitar">
          <h2 id="h-quitar">Volver a los ajustes del sitio</h2>
          <BotonConfirmar
            etiqueta="Quitar los ajustes de este país"
            mensaje="Este país dejará de tener colores y tipografía propios y usará los del sitio."
            etiquetaConfirmar="Sí, quitar"
            accion={quitarAjustesPais.bind(null, pais)}
          />
        </section>
      ) : null}
    </>
  );
}
