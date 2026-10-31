/**
 * Ayudas comunes de las pruebas de la tienda: producto de prueba con stock, formato de dinero tal como se ve
 * en pantalla y llenado del bolso por la interfaz (no escribiendo en localStorage, para probar el flujo real).
 */
import { expect, type Page } from '@playwright/test';
import type { Pais } from './entorno';
import { RUTAS } from './rutas';
import { visiblesEn, type ProductoSemilla } from './semilla';

/** Primer producto visible en ambos países con stock en todas sus variantes. */
export function productoConStock(): ProductoSemilla {
  const p = visiblesEn('co').find(
    (x) => visiblesEn('ec').includes(x) && x.variants.every((v) => (v.countries.co?.stock ?? 0) > 0 && (v.countries.ec?.stock ?? 0) > 0),
  );
  if (!p) throw new Error('No hay un producto con stock en ambos países en los datos de prueba');
  return p;
}

/** Precio de una variante tal como lo muestra la tienda: COP "300.000" (pesos); USD "81,00" (centavos). */
export function precioVisible(pais: Pais, unidadMenor: number): string {
  return pais === 'co'
    ? new Intl.NumberFormat('es-CO').format(unidadMenor)
    : new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(unidadMenor / 100);
}

/** El navegador pone espacios duros entre el símbolo y la cifra: se comparan como espacios normales. */
export const sinEspaciosDuros = (t: string | null | undefined) =>
  (t ?? '').split(String.fromCharCode(160)).join(' ').split(String.fromCharCode(8239)).join(' ').replace(/\s+/g, ' ').trim();

/**
 * Abre la ficha y agrega la primera presentación al bolso `veces` veces. Agregar abre el cajón del bolso; se cierra
 * con Esc salvo que `dejarAbierto` (la última vez) para probar el cajón.
 */
export async function agregarDesdeFicha(page: Page, pais: Pais, slug: string, veces = 1, dejarAbierto = false): Promise<void> {
  await page.goto(RUTAS.ficha(pais, slug));
  await expect(page.getByTestId('ficha')).toBeVisible();
  for (let i = 0; i < veces; i += 1) {
    await page.getByTestId('boton-agregar').first().click();
    await expect(page.getByTestId('contador-carrito')).toHaveText(String(i + 1));
    if (dejarAbierto && i === veces - 1) return;
    // Esc solo cierra cuando el cajón terminó de abrirse y tiene el foco.
    const cajon = page.getByRole('dialog');
    await expect(cajon).toBeVisible();
    await expect(cajon).toBeFocused().catch(() => undefined);
    await page.keyboard.press('Escape');
    await expect(cajon).toBeHidden();
  }
}

/**
 * Cuerpo multipart armado a mano: `APIRequestContext` no admite repetir un mismo nombre de archivo (varias fotos
 * bajo `fotos`), y la tienda las lee con `form.getAll`.
 */
export function multipartManual(
  campos: Record<string, string>,
  nombreArchivos: string,
  archivos: { nombre: string; datos: Buffer }[],
): { contentType: string; cuerpo: Buffer } {
  const frontera = `----izaoqa${Date.now().toString(16)}`;
  const fin = '\r\n';
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${frontera}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const a of archivos) {
    partes.push(
      Buffer.from(`--${frontera}\r\nContent-Disposition: form-data; name="${nombreArchivos}"; filename="${a.nombre}"\r\nContent-Type: application/octet-stream` + '\r\n\r\n'),
      a.datos,
      Buffer.from(fin),
    );
  }
  partes.push(Buffer.from(`--${frontera}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${frontera}`, cuerpo: Buffer.concat(partes) };
}
