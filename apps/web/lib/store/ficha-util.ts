/** Utilidades puras de la ficha: nombre de la presentación, variante inicial y línea del carrito. */
import type { LineaCarrito } from './carrito/logica';
import type { FichaProducto, VarianteProducto } from './types';

export function presentacionDe(ficha: Pick<FichaProducto, 'options'>, v: Pick<VarianteProducto, 'option_value_ids'>): string | null {
  const nombres = ficha.options.flatMap((o) => o.values).filter((val) => v.option_value_ids.includes(val.id)).map((val) => val.value);
  return nombres.length ? nombres.join(' · ') : null;
}

/** La variante por defecto si hay existencias; si no, la primera con existencias; si no, la por defecto. */
export function varianteInicial(variantes: readonly VarianteProducto[]): VarianteProducto | null {
  return (
    variantes.find((v) => v.is_default && v.in_stock) ?? variantes.find((v) => v.in_stock) ?? variantes.find((v) => v.is_default) ?? variantes[0] ?? null
  );
}

/**
 * Variante pedida por `?variante={SKU}` (enlaces de los banners). Compara el SKU sin distinguir mayúsculas; también
 * acepta el id de la variante. Si no existe o está agotada devuelve `null` y la ficha conserva la variante por defecto.
 */
export function varianteDeSku(variantes: readonly VarianteProducto[], sku: string | null | undefined): VarianteProducto | null {
  const clave = (sku ?? '').trim().toLowerCase();
  if (!clave || clave.length > 80) return null;
  const v = variantes.find((x) => (x.sku ?? '').toLowerCase() === clave || x.id.toLowerCase() === clave);
  return v && v.in_stock ? v : null;
}

export function lineaDe(ficha: FichaProducto, v: VarianteProducto, cantidad = 1): Omit<LineaCarrito, 'cantidad'> & { cantidad: number } {
  const imagen = v.image ?? ficha.img_primary ?? ficha.images[0]?.media ?? null;
  return {
    variantId: v.id,
    productId: ficha.product_id,
    slug: ficha.slug,
    nombre: ficha.name,
    presentacion: presentacionDe(ficha, v),
    cantidad,
    precio: String(v.price),
    tachado: v.compare_at_price ? String(v.compare_at_price) : null,
    max: Math.max(v.stock_disponible, 1),
    // Solo lo que hace falta para pintar la miniatura: el bolso vive en localStorage.
    imagen: imagen ? { variants: imagen.variants ?? null, lqip: imagen.lqip ?? null, alt: imagen.alt ?? null, width: imagen.width ?? null, height: imagen.height ?? null } : null,
  };
}

/**
 * Compra con un toque desde la tarjeta: solo hay variante «obvia» si el aroma tiene una única presentación y está
 * disponible. En cualquier otro caso se le deja elegir (vista rápida) en vez de agregar a ciegas.
 */
export function varianteDirecta(variantes: readonly VarianteProducto[]): VarianteProducto | null {
  return variantes.length === 1 && variantes[0]!.in_stock ? variantes[0]! : null;
}
