/**
 * Dónde se muestra y cómo se coloca el botón flotante de WhatsApp (puro, para probarlo sin navegador).
 * La tienda cuelga de `/{país}/…`.
 */

/** Pantallas donde el botón se oculta: pago y confirmación (ya traen su propio enlace al asesor y no se debe tapar nada). */
const SIN_BOTON = /^\/(?:co|ec)\/(?:checkout|pagar|pedido)(?:\/|$)/;
const FICHA = /^\/(?:co|ec)\/perfume\//;

export function botonWhatsappVisible(ruta: string | null): boolean {
  return !SIN_BOTON.test(ruta ?? '');
}

/** En la ficha, en móvil, el botón sube para quedar por encima de la barra fija de compra (alto 112 px). */
export function botonWhatsappSobreBarra(ruta: string | null): boolean {
  return FICHA.test(ruta ?? '');
}
