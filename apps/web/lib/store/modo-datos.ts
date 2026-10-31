/**
 * ¿Se pueden usar los datos de ejemplo (sin base)? En producción NUNCA, salvo en un build de PRUEBAS que lo pida con
 * `STORE_DATOS_PERMITIR_EJEMPLO=1` (y, además, `STORE_DATOS=ejemplo`): así las pruebas e2e y Lighthouse miden el build de
 * producción real sin llaves y sin parchar copias del código. Un despliegue de verdad no define esa variable.
 */
export function ejemploPermitido(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.STORE_DATOS_PERMITIR_EJEMPLO === '1';
}
