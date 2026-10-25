/** Selector de país del dashboard (§21.1): Colombia, Ecuador o Todos. Puro; valor seguro por defecto. */
export const OPCIONES_PAIS_DASHBOARD = ['TODOS', 'CO', 'EC'] as const;
export type PaisDashboardUrl = (typeof OPCIONES_PAIS_DASHBOARD)[number];

export const ETIQUETA_PAIS_DASHBOARD: Record<PaisDashboardUrl, string> = {
  TODOS: 'Todos',
  CO: 'Colombia',
  EC: 'Ecuador',
};

export function leerPaisDashboard(valor: string | string[] | undefined): PaisDashboardUrl {
  const v = (Array.isArray(valor) ? valor[0] : valor)?.toUpperCase();
  return v === 'CO' || v === 'EC' ? v : 'TODOS';
}
