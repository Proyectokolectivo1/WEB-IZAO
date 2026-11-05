/**
 * Fuentes del selector de Apariencia (solo el panel). Cada una declara su variable `--fuente-{id}` con `next/font`
 * (autohospedada, subset latin, `display: swap`, SIN precarga): el navegador baja un archivo únicamente cuando la
 * vista previa del selector lo pinta, es decir, cuando la persona abre la lista. `next/font` exige opciones literales,
 * por eso cada fuente repite las suyas; el listado coincide con `FUENTES_CATALOGO` (una prueba lo comprueba).
 * La tienda NO importa este archivo.
 */
import {
  Cormorant_Garamond,
  Cormorant,
  Playfair_Display,
  Fraunces,
  Libre_Caslon_Display,
  Bodoni_Moda,
  Cinzel,
  Marcellus,
  Prata,
  DM_Serif_Display,
  Gilda_Display,
  Italiana,
  Bellefair,
  Instrument_Serif,
  EB_Garamond,
  Lora,
  Newsreader,
  Crimson_Pro,
  Libre_Baskerville,
  Manrope,
  Jost,
  Inter_Tight,
  Karla,
  Mulish,
  DM_Sans,
  Inter,
  Montserrat,
  Raleway,
  Outfit,
  Figtree,
  Plus_Jakarta_Sans,
  Albert_Sans,
  Hanken_Grotesk,
  Urbanist,
  Tenor_Sans,
  Josefin_Sans,
  Questrial,
  Work_Sans,
} from 'next/font/google';

const f_cormorant_garamond = Cormorant_Garamond({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-cormorant-garamond' });
const f_cormorant = Cormorant({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-cormorant' });
const f_playfair_display = Playfair_Display({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-playfair-display' });
const f_fraunces = Fraunces({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-fraunces' });
const f_libre_caslon_display = Libre_Caslon_Display({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-libre-caslon-display' });
const f_bodoni_moda = Bodoni_Moda({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-bodoni-moda' });
const f_cinzel = Cinzel({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-cinzel' });
const f_marcellus = Marcellus({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-marcellus' });
const f_prata = Prata({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-prata' });
const f_dm_serif_display = DM_Serif_Display({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-dm-serif-display' });
const f_gilda_display = Gilda_Display({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-gilda-display' });
const f_italiana = Italiana({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-italiana' });
const f_bellefair = Bellefair({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-bellefair' });
const f_instrument_serif = Instrument_Serif({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-instrument-serif' });
const f_eb_garamond = EB_Garamond({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-eb-garamond' });
const f_lora = Lora({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-lora' });
const f_newsreader = Newsreader({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-newsreader' });
const f_crimson_pro = Crimson_Pro({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-crimson-pro' });
const f_libre_baskerville = Libre_Baskerville({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-libre-baskerville' });
const f_manrope = Manrope({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-manrope' });
const f_jost = Jost({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-jost' });
const f_inter_tight = Inter_Tight({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-inter-tight' });
const f_karla = Karla({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-karla' });
const f_mulish = Mulish({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-mulish' });
const f_dm_sans = DM_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-dm-sans' });
const f_inter = Inter({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-inter' });
const f_montserrat = Montserrat({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-montserrat' });
const f_raleway = Raleway({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-raleway' });
const f_outfit = Outfit({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-outfit' });
const f_figtree = Figtree({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-figtree' });
const f_plus_jakarta_sans = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-plus-jakarta-sans' });
const f_albert_sans = Albert_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-albert-sans' });
const f_hanken_grotesk = Hanken_Grotesk({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-hanken-grotesk' });
const f_urbanist = Urbanist({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-urbanist' });
const f_tenor_sans = Tenor_Sans({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-tenor-sans' });
const f_josefin_sans = Josefin_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-josefin-sans' });
const f_questrial = Questrial({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--fuente-questrial' });
const f_work_sans = Work_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--fuente-work-sans' });

/** Clases que definen todas las variables `--fuente-*`; se aplican al contenedor del selector. */
export const CLASES_FUENTES_PREVIA = [
  f_cormorant_garamond.variable,
  f_cormorant.variable,
  f_playfair_display.variable,
  f_fraunces.variable,
  f_libre_caslon_display.variable,
  f_bodoni_moda.variable,
  f_cinzel.variable,
  f_marcellus.variable,
  f_prata.variable,
  f_dm_serif_display.variable,
  f_gilda_display.variable,
  f_italiana.variable,
  f_bellefair.variable,
  f_instrument_serif.variable,
  f_eb_garamond.variable,
  f_lora.variable,
  f_newsreader.variable,
  f_crimson_pro.variable,
  f_libre_baskerville.variable,
  f_manrope.variable,
  f_jost.variable,
  f_inter_tight.variable,
  f_karla.variable,
  f_mulish.variable,
  f_dm_sans.variable,
  f_inter.variable,
  f_montserrat.variable,
  f_raleway.variable,
  f_outfit.variable,
  f_figtree.variable,
  f_plus_jakarta_sans.variable,
  f_albert_sans.variable,
  f_hanken_grotesk.variable,
  f_urbanist.variable,
  f_tenor_sans.variable,
  f_josefin_sans.variable,
  f_questrial.variable,
  f_work_sans.variable,
].join(' ');

export const IDS_FUENTES_PREVIA: readonly string[] = ['cormorant-garamond', 'cormorant', 'playfair-display', 'fraunces', 'libre-caslon-display', 'bodoni-moda', 'cinzel', 'marcellus', 'prata', 'dm-serif-display', 'gilda-display', 'italiana', 'bellefair', 'instrument-serif', 'eb-garamond', 'lora', 'newsreader', 'crimson-pro', 'libre-baskerville', 'manrope', 'jost', 'inter-tight', 'karla', 'mulish', 'dm-sans', 'inter', 'montserrat', 'raleway', 'outfit', 'figtree', 'plus-jakarta-sans', 'albert-sans', 'hanken-grotesk', 'urbanist', 'tenor-sans', 'josefin-sans', 'questrial', 'work-sans'];
