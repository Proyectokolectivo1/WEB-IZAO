/**
 * Utilidades de navegación del navegador para el listado (solo cliente).
 * - `llegoPorAtras()`: ¿esta pantalla se abrió con el botón Atrás/Adelante? (para restaurar lotes y scroll).
 * - `abrirIza()`: pide al widget del chatbot que se abra; el widget escucha el evento `izao:abrir-iza`.
 */

let atras = false;
let tipoInicialUsado = false;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    atras = true;
  });
  // Un clic en cualquier enlace es una navegación nueva, no un regreso.
  document.addEventListener('click', () => {
    atras = false;
  }, true);
}

/** Se consume: la segunda llamada devuelve `false` hasta la próxima navegación hacia atrás. */
export function llegoPorAtras(): boolean {
  if (typeof window === 'undefined') return false;
  let r = atras;
  if (!tipoInicialUsado) {
    tipoInicialUsado = true;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'back_forward') r = true;
  }
  atras = false;
  return r;
}

export function abrirIza(contexto?: { producto?: string; busqueda?: string }): void {
  window.dispatchEvent(new CustomEvent('izao:abrir-iza', { detail: contexto ?? {} }));
}
