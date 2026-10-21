/**
 * Estado de conexión de un agente a partir de su último latido (heartbeat cada 30 s, §15). Puro.
 *  - en línea: latido hace menos de 2 minutos (verde)
 *  - retrasado: hasta 5 minutos (amarillo)
 *  - sin latido: más de 5 minutos o nunca conectó (rojo; el mismo umbral de la alerta del worker)
 */
export const UMBRAL_EN_LINEA_MS = 2 * 60_000;
export const UMBRAL_SIN_LATIDO_MS = 5 * 60_000;

export type EstadoConexion = 'en_linea' | 'retrasado' | 'sin_latido' | 'nunca' | 'desactivado';

export const ETIQUETA_CONEXION: Record<EstadoConexion, string> = {
  en_linea: 'En línea',
  retrasado: 'Retrasado',
  sin_latido: 'Sin latido',
  nunca: 'Nunca se ha conectado',
  desactivado: 'Desactivado',
};

export function estadoConexion(activo: boolean, ultimoLatido: string | null, ahora: Date): EstadoConexion {
  if (!activo) return 'desactivado';
  if (!ultimoLatido) return 'nunca';
  const t = Date.parse(ultimoLatido);
  if (Number.isNaN(t)) return 'nunca';
  const edad = ahora.getTime() - t;
  if (edad < UMBRAL_EN_LINEA_MS) return 'en_linea';
  if (edad < UMBRAL_SIN_LATIDO_MS) return 'retrasado';
  return 'sin_latido';
}
