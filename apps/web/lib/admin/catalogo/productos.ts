/**
 * Editor de productos del panel (§24.1): esquema del formulario, conversión al payload de
 * `admin_guardar_producto`, validación del vínculo MasterShop y operaciones puras sobre las variantes.
 *
 * Código puro (sin servidor ni navegador): lo usan el formulario, la Server Action y las pruebas.
 * Dinero: el formulario trabaja en unidad mayor como texto (`"90.000"`, `"49.90"`); aquí se convierte
 * a entero en unidad menor con `@izao/core/money` (COP exponente 0, USD exponente 2). Nunca `float`.
 */
import {
  COUNTRY_CURRENCY,
  fromDbAmount,
  fromMajorString,
  money,
  toDecimalString,
  type CurrencyCode,
} from '@izao/core/money';
import { z } from 'zod';
import type { GuardarProductoEntrada } from '@/lib/db/admin-catalogo';
import { PATRON_SLUG, type ErroresCampo } from '../crud/comun';

export const PAISES_PRODUCTO = ['CO', 'EC'] as const;
export type PaisProducto = (typeof PAISES_PRODUCTO)[number];
export const ESTADOS_PRODUCTO = ['draft', 'active', 'archived'] as const;
export type EstadoProducto = (typeof ESTADOS_PRODUCTO)[number];
export const ETIQUETA_ESTADO: Record<EstadoProducto, string> = {
  draft: 'Borrador',
  active: 'Activo',
  archived: 'Archivado',
};
export const NIVELES = ['baja', 'media', 'alta', 'muy_alta'] as const;
export const ETIQUETA_NIVEL: Record<(typeof NIVELES)[number], string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  muy_alta: 'Muy alta',
};
export const ROLES_IMAGEN = ['primary', 'hover', 'gallery'] as const;
export type RolImagen = (typeof ROLES_IMAGEN)[number];
export const ETIQUETA_ROL_IMAGEN: Record<RolImagen, string> = {
  primary: 'Principal',
  hover: 'Al pasar el cursor',
  gallery: 'Galería',
};

// ---------------------------------------------------------------------------------------------
// Forma del formulario (todo texto o booleano: así viaja del navegador a la Server Action)
// ---------------------------------------------------------------------------------------------

const guid = z.guid();
const pais = z.enum(PAISES_PRODUCTO);
const t = (max: number) => z.string().max(max).default('');

const varianteDelPaisForm = z.object({
  country_code: pais,
  is_active: z.boolean(),
  price: t(30),
  compare_at_price: t(30),
  cost: t(30),
  stock: t(12),
  low_stock_threshold: t(12),
});

const varianteForm = z.object({
  id: guid,
  sku: t(80),
  option_value_ids: z.array(guid).max(10).default([]),
  weight_kg: t(12),
  is_default: z.boolean(),
  mastershop_product_id: t(12),
  mastershop_variant_id: t(12),
  image_id: z.union([guid, z.literal('')]).default(''),
  countries: z.array(varianteDelPaisForm).max(2),
});

const opcionForm = z.object({
  id: guid,
  name: t(80),
  values: z.array(z.object({ id: guid, value: t(80) })).max(60),
});

const paisProductoForm = z.object({
  country_code: pais,
  is_visible: z.boolean(),
  is_featured: z.boolean(),
  featured_rank: t(8),
  badges: t(200),
});

const imagenForm = z.object({
  media_id: guid,
  role: z.enum(ROLES_IMAGEN),
  /** Solo para mostrar la miniatura; no se envía a la base. */
  ruta: t(300),
  alt: t(200),
});

export const esquemaProductoForm = z.object({
  id: guid.optional(),
  name: t(200),
  slug: t(120),
  short_description: t(500),
  description_html: t(20000),
  brand_id: z.union([guid, z.literal('')]).default(''),
  gender_id: z.union([guid, z.literal('')]).default(''),
  family_id: z.union([guid, z.literal('')]).default(''),
  concentration_id: z.union([guid, z.literal('')]).default(''),
  notes_top: t(500),
  notes_heart: t(500),
  notes_base: t(500),
  occasion: t(300),
  season: t(300),
  longevity: z.union([z.enum(NIVELES), z.literal('')]).default(''),
  sillage: z.union([z.enum(NIVELES), z.literal('')]).default(''),
  seo_title: t(70),
  seo_description: t(160),
  status: z.enum(ESTADOS_PRODUCTO),
  category_ids: z.array(guid).max(50).default([]),
  countries: z.array(paisProductoForm).max(2),
  options: z.array(opcionForm).max(3),
  variants: z.array(varianteForm).min(1).max(200),
  images: z.array(imagenForm).max(30),
});
export type ProductoForm = z.infer<typeof esquemaProductoForm>;
export type VarianteForm = ProductoForm['variants'][number];
export type VarianteDelPaisForm = VarianteForm['countries'][number];
export type OpcionForm = ProductoForm['options'][number];
export type PaisProductoForm = ProductoForm['countries'][number];
export type ImagenForm = ProductoForm['images'][number];

/** Se pasa desde fuera para que las pruebas sean deterministas (en el navegador: `crypto.randomUUID`). */
export type GeneradorId = () => string;

// ---------------------------------------------------------------------------------------------
// Dinero y números
// ---------------------------------------------------------------------------------------------

const MAXIMO_UNIDAD_MENOR = 10n ** 12n;

/**
 * Texto en unidad mayor -> entero en unidad menor. Acepta lo que escribe una persona:
 * COP `90.000`, `$ 90000`; USD `49.90`, `49,90`, `1,234.50`. Sin decimales de más ni negativos.
 */
export function parsearMonto(texto: string, moneda: CurrencyCode): { ok: true; valor: bigint } | { ok: false } {
  const limpio = texto.replace(/[\s$]/g, '');
  let normal: string | null = null;
  if (moneda === 'COP') {
    if (/^\d+$/.test(limpio)) normal = limpio;
    else if (/^\d{1,3}([.,]\d{3})+$/.test(limpio)) normal = limpio.replace(/[.,]/g, '');
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(limpio)) {
    normal = limpio.replace(/,/g, '');
  } else if (/^\d+(\.\d{1,2})?$/.test(limpio)) {
    normal = limpio;
  } else if (/^\d+,\d{1,2}$/.test(limpio)) {
    normal = limpio.replace(',', '.');
  }
  if (normal === null) return { ok: false };
  try {
    const valor = fromMajorString(normal, moneda).amount;
    return valor <= MAXIMO_UNIDAD_MENOR ? { ok: true, valor } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Entero en unidad menor de la base -> texto en unidad mayor para el formulario. */
export function montoATexto(valor: bigint | number | string | null | undefined, moneda: CurrencyCode): string {
  if (valor === null || valor === undefined) return '';
  return toDecimalString(money(fromDbAmount(valor), moneda));
}

function entero(texto: string, maximo: number): number | null {
  if (!/^\d{1,9}$/.test(texto.trim())) return null;
  const n = Number(texto.trim());
  return n <= maximo ? n : null;
}

/** Lista escrita por una persona (`a, b | c`) -> elementos únicos sin vacíos. */
export function separarLista(texto: string): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const parte of texto.split(/[,|\n]/)) {
    const v = parte.trim();
    const clave = v.toLowerCase();
    if (v && !vistos.has(clave)) {
      vistos.add(clave);
      salida.push(v);
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// Vínculo con MasterShop
// ---------------------------------------------------------------------------------------------

export const MENSAJE_SIN_VINCULO =
  'Para publicar en Colombia, vincula la variante con MasterShop (identificador del producto) o desactívala en Colombia.';

/**
 * Posiciones de las variantes que no pueden publicarse: producto activo, visible en Colombia y la
 * variante activa en Colombia sin `mastershop_product_id`. Es la misma regla que repite la base.
 */
export function variantesSinVinculo(args: {
  status: EstadoProducto;
  visibleEnCO: boolean;
  variantes: readonly { activaEnCO: boolean; mastershopProductId: number | null }[];
}): number[] {
  if (args.status !== 'active' || !args.visibleEnCO) return [];
  const faltan: number[] = [];
  args.variantes.forEach((v, i) => {
    if (v.activaEnCO && v.mastershopProductId === null) faltan.push(i);
  });
  return faltan;
}

// ---------------------------------------------------------------------------------------------
// Etiquetas y ordenamiento
// ---------------------------------------------------------------------------------------------

/** `100 ml / Estuche` según los valores elegidos; `Única` si el producto no tiene opciones. */
export function etiquetaVariante(opciones: readonly OpcionForm[], variante: Pick<VarianteForm, 'option_value_ids'>): string {
  const partes: string[] = [];
  for (const o of opciones) {
    const v = o.values.find((x) => variante.option_value_ids.includes(x.id));
    if (v?.value) partes.push(v.value);
  }
  return partes.length ? partes.join(' / ') : 'Única';
}

/** Mueve un elemento `delta` posiciones (negativo = antes). Devuelve una copia. */
export function mover<T>(lista: readonly T[], desde: number, delta: number): T[] {
  const a = [...lista];
  const hasta = desde + delta;
  if (desde < 0 || desde >= a.length || hasta < 0 || hasta >= a.length) return a;
  const [x] = a.splice(desde, 1);
  a.splice(hasta, 0, x as T);
  return a;
}

/** Deja una sola imagen principal y una sola de cursor; si hay imágenes y ninguna principal, la primera lo es. */
export function normalizarImagenes<T extends { media_id: string; role: RolImagen }>(imagenes: readonly T[]): T[] {
  const vistas = new Set<string>();
  let hayPrincipal = false;
  let hayHover = false;
  const salida: T[] = [];
  for (const img of imagenes) {
    if (vistas.has(img.media_id)) continue;
    vistas.add(img.media_id);
    let role = img.role;
    if (role === 'primary') {
      if (hayPrincipal) role = 'gallery';
      else hayPrincipal = true;
    } else if (role === 'hover') {
      if (hayHover) role = 'gallery';
      else hayHover = true;
    }
    salida.push({ ...img, role });
  }
  if (salida.length > 0 && !hayPrincipal) {
    const i = salida.findIndex((x) => x.role === 'gallery');
    const j = i >= 0 ? i : 0;
    salida[j] = { ...(salida[j] as T), role: 'primary' };
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// Operaciones sobre el formulario (las usa el cliente; puras)
// ---------------------------------------------------------------------------------------------

export function paisesVarianteVacios(): VarianteDelPaisForm[] {
  return PAISES_PRODUCTO.map((country_code) => ({
    country_code,
    is_active: false,
    price: '',
    compare_at_price: '',
    cost: '',
    stock: '0',
    low_stock_threshold: '',
  }));
}

export function varianteNueva(id: string, opciones?: { option_value_ids?: string[]; esPrimera?: boolean }): VarianteForm {
  return {
    id,
    sku: '',
    option_value_ids: opciones?.option_value_ids ?? [],
    weight_kg: '0.5',
    is_default: opciones?.esPrimera ?? false,
    mastershop_product_id: '',
    mastershop_variant_id: '',
    image_id: '',
    countries: paisesVarianteVacios(),
  };
}

export function productoNuevo(nuevoId: GeneradorId): ProductoForm {
  return {
    name: '',
    slug: '',
    short_description: '',
    description_html: '',
    brand_id: '',
    gender_id: '',
    family_id: '',
    concentration_id: '',
    notes_top: '',
    notes_heart: '',
    notes_base: '',
    occasion: '',
    season: '',
    longevity: '',
    sillage: '',
    seo_title: '',
    seo_description: '',
    status: 'draft',
    category_ids: [],
    countries: PAISES_PRODUCTO.map((country_code) => ({
      country_code,
      is_visible: false,
      is_featured: false,
      featured_rank: '',
      badges: '',
    })),
    options: [],
    variants: [varianteNueva(nuevoId(), { esPrimera: true })],
    images: [],
  };
}

/** Combinaciones de valores (una por opción) que aún no tienen variante. */
export function combinacionesFaltantes(form: Pick<ProductoForm, 'options' | 'variants'>): string[][] {
  const opciones = form.options.filter((o) => o.values.length > 0);
  if (opciones.length === 0) return [];
  let combos: string[][] = [[]];
  for (const o of opciones) combos = combos.flatMap((c) => o.values.map((v) => [...c, v.id]));
  const existentes = new Set(form.variants.map((v) => [...v.option_value_ids].sort().join('|')));
  return combos.filter((c) => !existentes.has([...c].sort().join('|')));
}

/** Agrega una variante por cada combinación que falte. Si la única variante no tenía valores, la reutiliza. */
export function generarVariantes(form: ProductoForm, nuevoId: GeneradorId): ProductoForm {
  const faltantes = combinacionesFaltantes(form);
  if (faltantes.length === 0) return form;
  const variantes = [...form.variants];
  let resto = faltantes;
  const vacia = variantes.findIndex((v) => v.option_value_ids.length === 0);
  if (vacia >= 0) {
    variantes[vacia] = { ...(variantes[vacia] as VarianteForm), option_value_ids: faltantes[0] as string[] };
    resto = faltantes.slice(1);
  }
  for (const c of resto) variantes.push(varianteNueva(nuevoId(), { option_value_ids: c }));
  return { ...form, variants: variantes };
}

export function agregarOpcion(form: ProductoForm, nuevoId: GeneradorId): ProductoForm {
  if (form.options.length >= 3) return form;
  return { ...form, options: [...form.options, { id: nuevoId(), name: '', values: [] }] };
}

/** Quitar una opción deja a las variantes sin sus valores (el administrador regenera las combinaciones). */
export function quitarOpcion(form: ProductoForm, opcionId: string): ProductoForm {
  const opcion = form.options.find((o) => o.id === opcionId);
  if (!opcion) return form;
  const ids = new Set(opcion.values.map((v) => v.id));
  return {
    ...form,
    options: form.options.filter((o) => o.id !== opcionId),
    variants: form.variants.map((v) => ({ ...v, option_value_ids: v.option_value_ids.filter((x) => !ids.has(x)) })),
  };
}

export function agregarValor(form: ProductoForm, opcionId: string, valorId: string, texto = ''): ProductoForm {
  return {
    ...form,
    options: form.options.map((o) => (o.id === opcionId ? { ...o, values: [...o.values, { id: valorId, value: texto }] } : o)),
  };
}

/** Quitar un valor elimina las variantes que lo usan (salvo que sea la única variante). */
export function quitarValor(form: ProductoForm, opcionId: string, valorId: string): ProductoForm {
  const options = form.options.map((o) => (o.id === opcionId ? { ...o, values: o.values.filter((v) => v.id !== valorId) } : o));
  let variants = form.variants.filter((v) => !v.option_value_ids.includes(valorId));
  if (variants.length === 0) {
    variants = form.variants.slice(0, 1).map((v) => ({ ...v, option_value_ids: v.option_value_ids.filter((x) => x !== valorId) }));
  }
  if (variants.length > 0 && !variants.some((v) => v.is_default)) {
    variants = variants.map((v, i) => (i === 0 ? { ...v, is_default: true } : v));
  }
  return { ...form, options, variants };
}

/** Marca una variante como la de por defecto y desmarca las demás. */
export function marcarPorDefecto(form: ProductoForm, varianteId: string): ProductoForm {
  return { ...form, variants: form.variants.map((v) => ({ ...v, is_default: v.id === varianteId })) };
}

/** Quita una variante; si era la de por defecto, la primera restante pasa a serlo. No deja el producto sin variantes. */
export function quitarVariante(form: ProductoForm, varianteId: string): ProductoForm {
  if (form.variants.length <= 1) return form;
  const variants = form.variants.filter((v) => v.id !== varianteId);
  if (!variants.some((v) => v.is_default)) variants[0] = { ...(variants[0] as VarianteForm), is_default: true };
  return { ...form, variants };
}

/**
 * Copia del producto como borrador: nuevos UUID, SKU y URL con sufijo `-copia`, invisible en todos los
 * países, sin vínculo MasterShop (el vínculo es de la variante original) y sin destacado.
 */
export function duplicarForm(form: ProductoForm, nuevoId: GeneradorId, intento = 1): ProductoForm {
  const sufijo = intento > 1 ? `-copia-${intento}` : '-copia';
  const mapaValores = new Map<string, string>();
  const options = form.options.map((o) => ({
    id: nuevoId(),
    name: o.name,
    values: o.values.map((v) => {
      const id = nuevoId();
      mapaValores.set(v.id, id);
      return { id, value: v.value };
    }),
  }));
  const { id: _id, ...resto } = form;
  void _id;
  return {
    ...resto,
    name: `${form.name} (copia)`.slice(0, 200),
    slug: `${form.slug}${sufijo}`.slice(0, 120),
    status: 'draft',
    countries: form.countries.map((c) => ({ ...c, is_visible: false, is_featured: false, featured_rank: '' })),
    options,
    variants: form.variants.map((v) => ({
      ...v,
      id: nuevoId(),
      sku: v.sku ? `${v.sku}${sufijo.toUpperCase()}`.slice(0, 80) : '',
      option_value_ids: v.option_value_ids.map((x) => mapaValores.get(x) ?? x),
      mastershop_product_id: '',
      mastershop_variant_id: '',
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Del formulario al payload de la RPC
// ---------------------------------------------------------------------------------------------

export type ResultadoConstruccion =
  | { ok: true; entrada: GuardarProductoEntrada }
  | { ok: false; errores: ErroresCampo };

const nuloSiVacio = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * Valida la semántica del formulario y arma el payload de `guardarProducto`. Los errores usan rutas
 * que el formulario reconoce: `name`, `slug`, `variants.0.sku`, `variants.0.CO.price`, `countries.CO.is_visible`,
 * `options.0.name`, `images`, `variants` (generales).
 */
export function construirEntrada(form: ProductoForm): ResultadoConstruccion {
  const errores: ErroresCampo = {};
  const falla = (clave: string, mensaje: string) => {
    if (!(clave in errores)) errores[clave] = mensaje;
  };

  const nombre = form.name.trim();
  if (nombre.length < 2) falla('name', 'Escribe el nombre del producto.');
  if (!PATRON_SLUG.test(form.slug)) falla('slug', 'Usa solo minúsculas, números y guiones (por ejemplo: aventus-100-ml).');

  // Opciones y valores
  const nombresOpcion = new Set<string>();
  const valorAOpcion = new Map<string, number>();
  form.options.forEach((o, i) => {
    const n = o.name.trim();
    if (!n) falla(`options.${i}.name`, 'Escribe el nombre de la opción (por ejemplo: Tamaño).');
    else if (nombresOpcion.has(n.toLowerCase())) falla(`options.${i}.name`, 'Ya hay otra opción con ese nombre.');
    nombresOpcion.add(n.toLowerCase());
    if (o.values.length === 0) falla(`options.${i}.values`, 'Agrega al menos un valor a la opción.');
    const vistos = new Set<string>();
    o.values.forEach((v, j) => {
      const texto = v.value.trim();
      if (!texto) falla(`options.${i}.values.${j}`, 'El valor no puede estar vacío.');
      else if (vistos.has(texto.toLowerCase())) falla(`options.${i}.values.${j}`, 'Valor repetido en la misma opción.');
      vistos.add(texto.toLowerCase());
      valorAOpcion.set(v.id, i);
    });
  });

  // Variantes
  if (form.variants.length === 0) falla('variants', 'El producto necesita al menos una variante.');
  const defaults = form.variants.filter((v) => v.is_default).length;
  if (form.variants.length > 0 && defaults !== 1) {
    falla('variants', defaults === 0 ? 'Elige cuál es la variante por defecto.' : 'Solo una variante puede ser la de por defecto.');
  }
  const skus = new Set<string>();
  const combinaciones = new Set<string>();
  const filasVariante: NonNullable<GuardarProductoEntrada['variants']> = [];

  form.variants.forEach((v, i) => {
    const sku = v.sku.trim();
    if (!sku) falla(`variants.${i}.sku`, 'El SKU es obligatorio.');
    else if (!/^[^\s]{1,80}$/.test(sku)) falla(`variants.${i}.sku`, 'El SKU no puede tener espacios.');
    else if (skus.has(sku.toLowerCase())) falla(`variants.${i}.sku`, 'SKU repetido en este producto.');
    skus.add(sku.toLowerCase());

    // Una variante elige un valor de cada opción.
    const porOpcion = new Set<number>();
    for (const id of v.option_value_ids) {
      const o = valorAOpcion.get(id);
      if (o === undefined) falla(`variants.${i}.options`, 'La variante usa un valor que ya no existe.');
      else if (porOpcion.has(o)) falla(`variants.${i}.options`, 'Solo se puede elegir un valor por opción.');
      else porOpcion.add(o);
    }
    if (form.options.length > 0 && porOpcion.size !== form.options.length) {
      falla(`variants.${i}.options`, 'Elige un valor para cada opción.');
    }
    const combo = [...v.option_value_ids].sort().join('|');
    if (combinaciones.has(combo)) falla(`variants.${i}.options`, 'Otra variante ya tiene esa combinación de valores.');
    combinaciones.add(combo);

    let peso: number | undefined;
    if (v.weight_kg.trim() !== '') {
      const n = Number(v.weight_kg.trim().replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || n > 100 || !/^\d+([.,]\d{1,3})?$/.test(v.weight_kg.trim())) {
        falla(`variants.${i}.weight_kg`, 'Peso en kg mayor que 0 (hasta 3 decimales).');
      } else peso = n;
    }

    const msProducto = v.mastershop_product_id.trim() === '' ? null : entero(v.mastershop_product_id, 2_000_000_000);
    const msVariante = v.mastershop_variant_id.trim() === '' ? null : entero(v.mastershop_variant_id, 2_000_000_000);
    if (v.mastershop_product_id.trim() !== '' && msProducto === null) {
      falla(`variants.${i}.mastershop_product_id`, 'El identificador de MasterShop es un número entero.');
    }
    if (v.mastershop_variant_id.trim() !== '' && msVariante === null) {
      falla(`variants.${i}.mastershop_variant_id`, 'El identificador de MasterShop es un número entero.');
    }

    const paisesVariante: NonNullable<NonNullable<GuardarProductoEntrada['variants']>[number]['countries']> = [];
    for (const c of v.countries) {
      const moneda = COUNTRY_CURRENCY[c.country_code];
      const clave = `variants.${i}.${c.country_code}`;
      const vacio = c.price.trim() === '' && c.compare_at_price.trim() === '' && c.cost.trim() === '' && !c.is_active;
      if (vacio) continue; // sin precio y desactivada: el país de la variante no existe
      const precio = parsearMonto(c.price, moneda);
      if (!precio.ok) {
        falla(`${clave}.price`, c.price.trim() === '' ? 'Escribe el precio.' : `Precio no válido en ${moneda}.`);
        continue;
      }
      let tachado: bigint | null = null;
      if (c.compare_at_price.trim() !== '') {
        const r = parsearMonto(c.compare_at_price, moneda);
        if (!r.ok) falla(`${clave}.compare_at_price`, `Precio tachado no válido en ${moneda}.`);
        else if (r.valor <= precio.valor) falla(`${clave}.compare_at_price`, 'El precio tachado debe ser mayor que el precio.');
        else tachado = r.valor;
      }
      let costo: bigint | null = null;
      if (c.cost.trim() !== '') {
        const r = parsearMonto(c.cost, moneda);
        if (!r.ok) falla(`${clave}.cost`, `Costo no válido en ${moneda}.`);
        else costo = r.valor;
      }
      const stock = c.stock.trim() === '' ? 0 : entero(c.stock, 1_000_000);
      if (stock === null) falla(`${clave}.stock`, 'El stock es un número entero de 0 en adelante.');
      const umbral = c.low_stock_threshold.trim() === '' ? null : entero(c.low_stock_threshold, 1_000_000);
      if (c.low_stock_threshold.trim() !== '' && umbral === null) {
        falla(`${clave}.low_stock_threshold`, 'El umbral es un número entero de 0 en adelante.');
      }
      paisesVariante.push({
        country_code: c.country_code,
        is_active: c.is_active,
        price: precio.valor.toString(),
        compare_at_price: tachado === null ? null : tachado.toString(),
        cost: costo === null ? null : costo.toString(),
        stock: stock ?? 0,
        low_stock_threshold: umbral,
      });
    }

    filasVariante.push({
      id: v.id,
      option_value_ids: v.option_value_ids,
      sku,
      ...(peso !== undefined ? { weight_kg: peso } : {}),
      is_default: v.is_default,
      mastershop_product_id: msProducto,
      mastershop_variant_id: msVariante,
      image_id: v.image_id || null,
      sort_order: i,
      countries: paisesVariante,
    });
  });

  // Países del producto
  const paisesProducto: NonNullable<GuardarProductoEntrada['countries']> = [];
  for (const c of form.countries) {
    let rango: number | null = null;
    if (c.featured_rank.trim() !== '') {
      rango = entero(c.featured_rank, 999_999);
      if (rango === null || rango < 1) falla(`countries.${c.country_code}.featured_rank`, 'Posición de 1 a 999999.');
    }
    if (c.is_visible) {
      const tiene = filasVariante.some((v) => v.countries?.some((x) => x.country_code === c.country_code && x.is_active));
      if (!tiene) {
        falla(
          `countries.${c.country_code}.is_visible`,
          'Para mostrarlo en este país, activa al menos una variante con precio en él.',
        );
      }
    }
    paisesProducto.push({
      country_code: c.country_code,
      is_visible: c.is_visible,
      is_featured: c.is_featured,
      featured_rank: rango,
      badges: separarLista(c.badges),
    });
  }

  // Vínculo MasterShop (Colombia)
  const visibleEnCO = paisesProducto.some((p) => p.country_code === 'CO' && p.is_visible);
  for (const i of variantesSinVinculo({
    status: form.status,
    visibleEnCO,
    variantes: filasVariante.map((v) => ({
      activaEnCO: Boolean(v.countries?.some((x) => x.country_code === 'CO' && x.is_active)),
      mastershopProductId: v.mastershop_product_id ?? null,
    })),
  })) {
    falla(`variants.${i}.mastershop_product_id`, MENSAJE_SIN_VINCULO);
  }

  // Imágenes
  const imagenes = normalizarImagenes(form.images);

  if (Object.keys(errores).length > 0) return { ok: false, errores };

  const entrada: GuardarProductoEntrada = {
    product: {
      ...(form.id ? { id: form.id } : {}),
      name: nombre,
      slug: form.slug,
      short_description: nuloSiVacio(form.short_description),
      description_html: nuloSiVacio(form.description_html),
      brand_id: form.brand_id || null,
      gender_id: form.gender_id || null,
      family_id: form.family_id || null,
      concentration_id: form.concentration_id || null,
      notes_top: separarLista(form.notes_top),
      notes_heart: separarLista(form.notes_heart),
      notes_base: separarLista(form.notes_base),
      occasion: separarLista(form.occasion),
      season: separarLista(form.season),
      longevity: form.longevity || null,
      sillage: form.sillage || null,
      seo_title: nuloSiVacio(form.seo_title),
      seo_description: nuloSiVacio(form.seo_description),
      status: form.status,
    },
    category_ids: [...new Set(form.category_ids)],
    countries: paisesProducto,
    options: form.options.map((o, i) => ({
      id: o.id,
      name: o.name.trim(),
      sort_order: i,
      values: o.values.map((v, j) => ({ id: v.id, value: v.value.trim(), sort_order: j })),
    })),
    variants: filasVariante,
    images: imagenes.map((m, i) => ({ media_id: m.media_id, role: m.role, sort_order: i })),
  };
  return { ok: true, entrada };
}

/** Traduce el motivo de rechazo de la base a mensajes para la persona, con el campo cuando se puede ubicar. */
export function errorDeMotivo(
  motivo: string,
  detalle: string | null | undefined,
  form: Pick<ProductoForm, 'variants'>,
): { mensaje: string; errores: ErroresCampo } {
  const errores: ErroresCampo = {};
  switch (motivo) {
    case 'slug_duplicado':
      errores.slug = 'Ese identificador de URL ya lo usa otro producto.';
      return { mensaje: errores.slug, errores };
    case 'sku_duplicado': {
      const i = form.variants.findIndex((v) => detalle?.toLowerCase().includes(v.sku.trim().toLowerCase()) && v.sku.trim() !== '');
      const texto = 'Ese SKU ya lo usa otro producto.';
      if (i >= 0) errores[`variants.${i}.sku`] = texto;
      return { mensaje: i >= 0 ? texto : `Hay un SKU que ya usa otro producto${detalle ? ` (${detalle})` : ''}.`, errores };
    }
    case 'variante_con_pedidos':
      return {
        mensaje: 'Quitaste una variante que ya tiene pedidos. Vuelve a agregarla y desactívala en los países en lugar de quitarla.',
        errores,
      };
    case 'sin_variante_por_defecto':
      errores.variants = 'Elige cuál es la variante por defecto.';
      return { mensaje: errores.variants, errores };
    case 'sin_vinculo_mastershop':
      return { mensaje: MENSAJE_SIN_VINCULO, errores };
    default:
      return { mensaje: `Los datos no son válidos${detalle ? `: ${detalle}` : ''}.`, errores };
  }
}

// ---------------------------------------------------------------------------------------------
// De la base al formulario
// ---------------------------------------------------------------------------------------------

export type ProductoBd = {
  product: {
    id: string;
    name: string;
    slug: string;
    short_description: string | null;
    description_html: string | null;
    brand_id: string | null;
    gender_id: string | null;
    family_id: string | null;
    concentration_id: string | null;
    notes_top: string[];
    notes_heart: string[];
    notes_base: string[];
    occasion: string[];
    season: string[];
    longevity: string | null;
    sillage: string | null;
    seo_title: string | null;
    seo_description: string | null;
    status: EstadoProducto;
  };
  categoryIds: string[];
  countries: { country_code: string; is_visible: boolean; is_featured: boolean; featured_rank: number | null; badges: string[] }[];
  options: { id: string; name: string; sort_order: number; values: { id: string; value: string; sort_order: number }[] }[];
  variants: {
    id: string;
    sku: string;
    option_value_ids: string[];
    weight_kg: number | string;
    is_default: boolean;
    mastershop_product_id: number | null;
    mastershop_variant_id: number | null;
    image_id: string | null;
    sort_order: number;
    countries: {
      country_code: string;
      is_active: boolean;
      price: number | string;
      compare_at_price: number | string | null;
      cost: number | string | null;
      stock: number;
      low_stock_threshold: number | null;
    }[];
  }[];
  images: { media_id: string; role: RolImagen; sort_order: number; ruta: string; alt: string }[];
};

const esPais = (c: string): c is PaisProducto => c === 'CO' || c === 'EC';
const nivel = (v: string | null): ProductoForm['longevity'] => (NIVELES as readonly string[]).includes(v ?? '') ? (v as ProductoForm['longevity']) : '';

/** Arma el formulario de edición desde las filas de la base (siempre con las dos filas de país). */
export function aFormulario(bd: ProductoBd): ProductoForm {
  const p = bd.product;
  const porOrden = <T extends { sort_order: number }>(a: readonly T[]) => [...a].sort((x, y) => x.sort_order - y.sort_order);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    short_description: p.short_description ?? '',
    description_html: p.description_html ?? '',
    brand_id: p.brand_id ?? '',
    gender_id: p.gender_id ?? '',
    family_id: p.family_id ?? '',
    concentration_id: p.concentration_id ?? '',
    notes_top: p.notes_top.join(', '),
    notes_heart: p.notes_heart.join(', '),
    notes_base: p.notes_base.join(', '),
    occasion: p.occasion.join(', '),
    season: p.season.join(', '),
    longevity: nivel(p.longevity),
    sillage: nivel(p.sillage),
    seo_title: p.seo_title ?? '',
    seo_description: p.seo_description ?? '',
    status: p.status,
    category_ids: bd.categoryIds,
    countries: PAISES_PRODUCTO.map((country_code) => {
      const c = bd.countries.find((x) => x.country_code === country_code);
      return {
        country_code,
        is_visible: c?.is_visible ?? false,
        is_featured: c?.is_featured ?? false,
        featured_rank: c?.featured_rank == null ? '' : String(c.featured_rank),
        badges: (c?.badges ?? []).join(', '),
      };
    }),
    options: porOrden(bd.options).map((o) => ({
      id: o.id,
      name: o.name,
      values: porOrden(o.values).map((v) => ({ id: v.id, value: v.value })),
    })),
    variants: porOrden(bd.variants).map((v) => ({
      id: v.id,
      sku: v.sku,
      option_value_ids: v.option_value_ids,
      weight_kg: String(Number(v.weight_kg)),
      is_default: v.is_default,
      mastershop_product_id: v.mastershop_product_id === null ? '' : String(v.mastershop_product_id),
      mastershop_variant_id: v.mastershop_variant_id === null ? '' : String(v.mastershop_variant_id),
      image_id: v.image_id ?? '',
      countries: PAISES_PRODUCTO.map((country_code) => {
        const c = v.countries.find((x) => x.country_code === country_code);
        if (!c) return { ...(paisesVarianteVacios().find((x) => x.country_code === country_code) as VarianteDelPaisForm) };
        const moneda = COUNTRY_CURRENCY[country_code];
        return {
          country_code,
          is_active: c.is_active,
          price: montoATexto(c.price, moneda),
          compare_at_price: montoATexto(c.compare_at_price, moneda),
          cost: montoATexto(c.cost, moneda),
          stock: String(c.stock),
          low_stock_threshold: c.low_stock_threshold === null ? '' : String(c.low_stock_threshold),
        };
      }),
    })),
    images: porOrden(bd.images).map((m) => ({ media_id: m.media_id, role: m.role, ruta: m.ruta, alt: m.alt })),
  };
}

export function paisValido(valor: string | undefined): PaisProducto | null {
  return valor && esPais(valor) ? valor : null;
}

// ---------------------------------------------------------------------------------------------
// Lista: filtros en la URL y resumen por país
// ---------------------------------------------------------------------------------------------

export type FiltrosProductos = {
  q: string;
  estado: EstadoProducto | '';
  marca: string;
  pais: PaisProducto | '';
  pagina: number;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee `?q&estado&marca&pais&page` con valores seguros. */
export function leerFiltrosProductos(sp: Buscables): FiltrosProductos {
  const estado = primero(sp.estado);
  const pais = primero(sp.pais);
  const marca = primero(sp.marca);
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    q: primero(sp.q).trim().slice(0, 100),
    estado: (ESTADOS_PRODUCTO as readonly string[]).includes(estado) ? (estado as EstadoProducto) : '',
    marca: UUID.test(marca) ? marca : '',
    pais: esPais(pais) ? pais : '',
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
  };
}

/** Parámetros de URL para conservar los filtros al paginar. */
export function parametrosFiltros(f: FiltrosProductos): Record<string, string> {
  const salida: Record<string, string> = {};
  if (f.q) salida.q = f.q;
  if (f.estado) salida.estado = f.estado;
  if (f.marca) salida.marca = f.marca;
  if (f.pais) salida.pais = f.pais;
  return salida;
}

export type ResumenPais = {
  visible: boolean;
  /** Precio más bajo entre las variantes activas, en unidad menor; `null` si ninguna está activa. */
  precioDesde: bigint | null;
  stock: number;
  variantesActivas: number;
};

/** Resumen del producto por país para la lista (precio desde, stock total, visibilidad). */
export function resumenPorPais(
  variantes: readonly { countries: readonly { country_code: string; is_active: boolean; price: number | string; stock: number }[] }[],
  paises: readonly { country_code: string; is_visible: boolean }[],
): Record<PaisProducto, ResumenPais> {
  const salida = {} as Record<PaisProducto, ResumenPais>;
  for (const code of PAISES_PRODUCTO) {
    let desde: bigint | null = null;
    let stock = 0;
    let activas = 0;
    for (const v of variantes) {
      for (const c of v.countries) {
        if (c.country_code !== code) continue;
        stock += c.stock;
        if (!c.is_active) continue;
        activas += 1;
        const precio = fromDbAmount(c.price);
        if (desde === null || precio < desde) desde = precio;
      }
    }
    salida[code] = {
      visible: paises.some((p) => p.country_code === code && p.is_visible),
      precioDesde: desde,
      stock,
      variantesActivas: activas,
    };
  }
  return salida;
}
