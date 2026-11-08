import { PAISES } from './pais';
import type { OpcionSede } from './sede';
import { TP } from './textos-pais';
import type { CodigoPais, EspacioContenido } from './types';

type Espacios = readonly Pick<EspacioContenido, 'key' | 'body'>[];

/**
 * Textos de cada sede. Las líneas de envío y de pago son del panel (espacios `sede_envio` y `sede_pago`, campo
 * cuerpo, uno por país); sin espacio o con el campo vacío, las del seed (`TP.sede.paises`).
 */
export function opcionesSede(espaciosPorPais: Readonly<Record<CodigoPais, Espacios>>): OpcionSede[] {
  return PAISES.map((pais) => {
    const base = TP.sede.paises[pais];
    const texto = (key: string) => espaciosPorPais[pais]?.find((e) => e.key === key)?.body?.trim();
    return { pais, nombre: base.nombre, moneda: base.moneda, envio: texto('sede_envio') || base.envio, pago: texto('sede_pago') || base.pago };
  });
}
