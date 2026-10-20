/**
 * Importar y exportar el catálogo (§24.2). Código puro: convierte una tabla (CSV o Excel) en filas de
 * `importarCatalogo` (una fila por producto, agrupando las variantes por `producto_slug`) y al revés.
 * Dinero: unidad mayor como texto -> entero en unidad menor con `parsearMonto` (COP exponente 0, USD 2).
 * Celda vacía = no cambia el dato; nunca borra.
 */
import { COUNTRY_CURRENCY } from '@izao/core/money';
import type { FilaImportacion } from '@/lib/db/admin-catalogo';
import { depurarHtml } from '@/lib/store/html-seguro';
import { slugificar } from '../crud/comun';
import {
  PAISES_PRODUCTO,
  montoATexto,
  normalizarImagenes,
  parsearMonto,
  separarLista,
  type EstadoProducto,
  type PaisProducto,
  type ProductoBd,
  type RolImagen,
} from './productos';

export const MAX_FILAS_ARCHIVO = 5000;

/** Plantilla de §24.2 (en ese orden) más opcionales: `estado`, `por_defecto` y una segunda opción. */
export const COLUMNAS = [
  'sku', 'producto_slug', 'nombre', 'marca', 'genero', 'familia', 'concentracion', 'categorias',
  'notas_salida', 'notas_corazon', 'notas_fondo', 'descripcion_corta', 'descripcion',
  'opcion_1_nombre', 'opcion_1_valor', 'peso_kg', 'mastershop_product_id', 'mastershop_variant_id',
  'visible_co', 'precio_co', 'tachado_co', 'costo_co', 'stock_co',
  'visible_ec', 'precio_ec', 'tachado_ec', 'costo_ec', 'stock_ec',
  'estado', 'por_defecto', 'opcion_2_nombre', 'opcion_2_valor',
] as const;
export type Columna = (typeof COLUMNAS)[number];

export type ErrorImportacion = { fila: number | null; sku: string | null; columna?: string; mensaje: string };

// ---------------------------------------------------------------------------------------------
// Texto de celdas
// ---------------------------------------------------------------------------------------------

/** Evita que Excel interprete una celda como fórmula al abrir el archivo exportado. */
export function neutralizarFormula(texto: string): string {
  return /^[=+@\t\r]/.test(texto) || /^-(?![\d.,])/.test(texto) ? `'${texto}` : texto;
}

function limpiarCelda(v: string | undefined): string {
  const t = (v ?? '').trim();
  return /^'[=+@\t\r-]/.test(t) ? t.slice(1) : t;
}

export function normalizarEncabezado(h: string): string {
  return slugificar(h).replace(/-/g, '_');
}

function booleano(v: string): boolean | null | 'error' {
  const t = slugificar(v);
  if (t === '') return null;
  if (['si', 's', '1', 'true', 'x', 'yes', 'y', 'verdadero'].includes(t)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(t)) return false;
  return 'error';
}

const ESTADOS: Record<string, EstadoProducto> = {
  borrador: 'draft', draft: 'draft', activo: 'active', active: 'active', archivado: 'archived', archived: 'archived',
};

// ---------------------------------------------------------------------------------------------
// Tabla -> objetos
// ---------------------------------------------------------------------------------------------

export type FilaTabla = { fila: number; valores: Partial<Record<Columna, string>> };

export function tablaAFilas(tabla: readonly (readonly string[])[]): {
  filas: FilaTabla[];
  ignoradas: string[];
  error?: string;
} {
  const encabezado = (tabla[0] ?? []).map((h) => normalizarEncabezado(h));
  if (!encabezado.includes('sku')) return { filas: [], ignoradas: [], error: 'Falta la columna "sku" en la primera fila.' };
  const conocidas = new Set<string>(COLUMNAS);
  const ignoradas = [...new Set(encabezado.filter((h) => h && !conocidas.has(h)))];
  const filas: FilaTabla[] = [];
  for (let i = 1; i < tabla.length; i += 1) {
    const celdas = tabla[i] ?? [];
    if (celdas.every((c) => (c ?? '').trim() === '')) continue;
    const valores: Partial<Record<Columna, string>> = {};
    encabezado.forEach((h, j) => {
      if (conocidas.has(h)) valores[h as Columna] = limpiarCelda(celdas[j]);
    });
    filas.push({ fila: i + 1, valores });
  }
  if (filas.length > MAX_FILAS_ARCHIVO) {
    return { filas: [], ignoradas, error: `El archivo tiene más de ${MAX_FILAS_ARCHIVO} filas. Divídelo en partes.` };
  }
  return { filas, ignoradas };
}

// ---------------------------------------------------------------------------------------------
// Catálogos (nombres -> ids)
// ---------------------------------------------------------------------------------------------

export type Catalogos = {
  marcas: Map<string, string>;
  generos: Map<string, string>;
  familias: Map<string, string>;
  concentraciones: Map<string, string>;
  categorias: Map<string, string>;
};

type FilaNombre = { id: string; name: string; slug: string };
type FilaCategoria = FilaNombre & { parent_id: string | null };

export function crearCatalogos(args: {
  marcas: readonly FilaNombre[];
  generos: readonly FilaNombre[];
  familias: readonly FilaNombre[];
  concentraciones: readonly FilaNombre[];
  categorias: readonly FilaCategoria[];
}): Catalogos {
  const mapa = (filas: readonly FilaNombre[]) => {
    const m = new Map<string, string>();
    for (const f of filas) {
      m.set(slugificar(f.name), f.id);
      m.set(f.slug, f.id);
    }
    return m;
  };
  const categorias = mapa(args.categorias);
  const porId = new Map(args.categorias.map((c) => [c.id, c]));
  for (const c of args.categorias) {
    const padre = c.parent_id ? porId.get(c.parent_id) : undefined;
    if (padre) categorias.set(`${slugificar(padre.name)}>${slugificar(c.name)}`, c.id);
  }
  return {
    marcas: mapa(args.marcas),
    generos: mapa(args.generos),
    familias: mapa(args.familias),
    concentraciones: mapa(args.concentraciones),
    categorias,
  };
}

// ---------------------------------------------------------------------------------------------
// Filas -> payload de importarCatalogo
// ---------------------------------------------------------------------------------------------

export type ProductoImportado = { slug: string; filas: number[]; skus: string[]; payload: FilaImportacion };

type Variante = NonNullable<FilaImportacion['variants']>[number];
type PaisVariante = NonNullable<Variante['countries']>[number];

/** Agrupa por `producto_slug` y valida cada celda. Un producto con algún error no se envía; los demás sí. */
export function construirImportacion(
  filas: readonly FilaTabla[],
  catalogos: Catalogos,
): { productos: ProductoImportado[]; errores: ErrorImportacion[]; omitidos: number } {
  const errores: ErrorImportacion[] = [];
  const grupos = new Map<string, { filas: FilaTabla[]; conErrores: boolean }>();
  const skusVistos = new Map<string, number>();
  const orden: string[] = [];

  for (const f of filas) {
    const sku = (f.valores.sku ?? '').trim();
    const slug = slugificar(f.valores.producto_slug || f.valores.nombre || '');
    const falla = (columna: string, mensaje: string) => errores.push({ fila: f.fila, sku: sku || null, columna, mensaje });
    let ok = true;
    if (!sku) {
      falla('sku', 'El SKU es obligatorio.');
      ok = false;
    } else if (/\s/.test(sku) || sku.length > 80) {
      falla('sku', 'El SKU no puede tener espacios ni más de 80 caracteres.');
      ok = false;
    } else if (skusVistos.has(sku.toLowerCase())) {
      falla('sku', `SKU repetido (ya aparece en la fila ${skusVistos.get(sku.toLowerCase())}).`);
      ok = false;
    } else skusVistos.set(sku.toLowerCase(), f.fila);
    if (!slug) {
      falla('producto_slug', 'Falta "producto_slug" (o "nombre" para generarlo).');
      ok = false;
    }
    if (!slug) continue;
    const g = grupos.get(slug) ?? { filas: [], conErrores: false };
    if (!grupos.has(slug)) orden.push(slug);
    g.filas.push(f);
    g.conErrores ||= !ok;
    grupos.set(slug, g);
  }

  const productos: ProductoImportado[] = [];
  for (const slug of orden) {
    const g = grupos.get(slug)!;
    const antes = errores.length;
    const payload = construirProducto(slug, g.filas, catalogos, errores);
    if (g.conErrores || errores.length > antes || !payload) continue;
    productos.push({ slug, filas: g.filas.map((x) => x.fila), skus: g.filas.map((x) => (x.valores.sku ?? '').trim()), payload });
  }
  return { productos, errores, omitidos: orden.length - productos.length };
}

function construirProducto(
  slug: string,
  filas: readonly FilaTabla[],
  cat: Catalogos,
  errores: ErrorImportacion[],
): FilaImportacion | null {
  const producto: FilaImportacion['product'] = { slug };
  const paisesProducto = new Map<PaisProducto, boolean>();
  let categorias: string[] | undefined;
  const nombresOpcion = new Map<number, string>();
  const valoresOpcion = new Map<number, string[]>();
  const variantes: Variante[] = [];

  const primero = <K extends keyof FilaImportacion['product']>(k: K, v: FilaImportacion['product'][K]) => {
    if (!(k in producto) && v !== undefined) producto[k] = v;
  };

  for (const f of filas) {
    const v = f.valores;
    const sku = (v.sku ?? '').trim();
    const falla = (columna: string, mensaje: string) => errores.push({ fila: f.fila, sku: sku || null, columna, mensaje });
    const texto = (c: Columna) => (v[c] ?? '').trim();

    if (texto('nombre')) primero('name', texto('nombre').slice(0, 200));
    if (texto('descripcion_corta')) primero('short_description', depurarHtml(texto('descripcion_corta')));
    if (texto('descripcion')) primero('description_html', depurarHtml(texto('descripcion')));
    for (const [col, clave] of [['notas_salida', 'notes_top'], ['notas_corazon', 'notes_heart'], ['notas_fondo', 'notes_base']] as const) {
      if (texto(col)) primero(clave, separarLista(texto(col)));
    }
    const buscar = (col: Columna, mapa: Map<string, string>, etiqueta: string) => {
      const t = texto(col);
      if (!t) return undefined;
      const id = mapa.get(slugificar(t));
      if (!id) falla(col, `${etiqueta} "${t}" no existe. Créala primero en el panel.`);
      return id;
    };
    const marca = buscar('marca', cat.marcas, 'La marca');
    if (marca) primero('brand_id', marca);
    const genero = buscar('genero', cat.generos, 'El género');
    if (genero) primero('gender_id', genero);
    const familia = buscar('familia', cat.familias, 'La familia olfativa');
    if (familia) primero('family_id', familia);
    const conc = buscar('concentracion', cat.concentraciones, 'La concentración');
    if (conc) primero('concentration_id', conc);

    if (texto('estado')) {
      const e = ESTADOS[slugificar(texto('estado'))];
      if (!e) falla('estado', 'Estado no válido: usa borrador, activo o archivado.');
      else primero('status', e);
    }

    if (texto('categorias') && categorias === undefined) {
      categorias = [];
      for (const nombre of texto('categorias').split('|').map((x) => x.trim()).filter(Boolean)) {
        const clave = nombre.split(/[>/]/).map((x) => slugificar(x)).join('>');
        const id = cat.categorias.get(clave);
        if (!id) falla('categorias', `La categoría "${nombre}" no existe.`);
        else if (!categorias.includes(id)) categorias.push(id);
      }
    }

    // Visibilidad por país (del producto)
    for (const p of PAISES_PRODUCTO) {
      const col = `visible_${p.toLowerCase()}` as Columna;
      const b = booleano(texto(col));
      if (b === 'error') falla(col, 'Usa sí o no.');
      else if (b !== null && !paisesProducto.has(p)) paisesProducto.set(p, b);
    }

    // Opciones
    const pares: { option: string; value: string }[] = [];
    for (const k of [1, 2] as const) {
      const n = texto(`opcion_${k}_nombre` as Columna);
      const val = texto(`opcion_${k}_valor` as Columna);
      if (!n && !val) continue;
      if (!n || !val) {
        falla(`opcion_${k}_valor`, 'La opción necesita nombre y valor.');
        continue;
      }
      const previo = nombresOpcion.get(k);
      if (previo && previo.toLowerCase() !== n.toLowerCase()) falla(`opcion_${k}_nombre`, `El nombre de la opción ${k} cambia entre filas del mismo producto.`);
      else nombresOpcion.set(k, previo ?? n);
      const lista = valoresOpcion.get(k) ?? [];
      if (!lista.some((x) => x.toLowerCase() === val.toLowerCase())) lista.push(val);
      valoresOpcion.set(k, lista);
      pares.push({ option: nombresOpcion.get(k) as string, value: val });
    }

    const variante: Variante = { sku };
    if (pares.length) variante.option_values = pares;
    if (texto('peso_kg')) {
      if (!/^\d+([.,]\d{1,3})?$/.test(texto('peso_kg')) || Number(texto('peso_kg').replace(',', '.')) <= 0 || Number(texto('peso_kg').replace(',', '.')) > 100) {
        falla('peso_kg', 'Peso en kg mayor que 0 (hasta 3 decimales).');
      } else variante.weight_kg = Number(texto('peso_kg').replace(',', '.'));
    }
    for (const c of ['mastershop_product_id', 'mastershop_variant_id'] as const) {
      if (!texto(c)) continue;
      if (!/^\d{1,10}$/.test(texto(c)) || Number(texto(c)) > 2_000_000_000) falla(c, 'El identificador de MasterShop es un número entero.');
      else variante[c] = Number(texto(c));
    }
    const def = booleano(texto('por_defecto'));
    if (def === 'error') falla('por_defecto', 'Usa sí o no.');
    else if (def === true) variante.is_default = true;

    const paises: PaisVariante[] = [];
    for (const p of PAISES_PRODUCTO) {
      const s = p.toLowerCase();
      const moneda = COUNTRY_CURRENCY[p];
      const pais: PaisVariante = { country_code: p };
      let alguno = false;
      const monto = (col: Columna) => {
        const r = parsearMonto(texto(col), moneda);
        if (!r.ok) falla(col, `Monto no válido en ${moneda} (sin símbolos; ${moneda === 'COP' ? 'enteros' : 'hasta 2 decimales'}).`);
        return r.ok ? r.valor.toString() : null;
      };
      if (texto(`precio_${s}` as Columna)) {
        const m = monto(`precio_${s}` as Columna);
        if (m !== null) {
          pais.price = m;
          pais.is_active = true;
          alguno = true;
        }
      }
      if (texto(`tachado_${s}` as Columna)) {
        const m = monto(`tachado_${s}` as Columna);
        if (m !== null) {
          if (pais.price !== undefined && BigInt(m) <= BigInt(pais.price)) falla(`tachado_${s}`, 'El precio tachado debe ser mayor que el precio.');
          pais.compare_at_price = m;
          alguno = true;
        }
      }
      if (texto(`costo_${s}` as Columna)) {
        const m = monto(`costo_${s}` as Columna);
        if (m !== null) {
          pais.cost = m;
          alguno = true;
        }
      }
      if (texto(`stock_${s}` as Columna)) {
        const t = texto(`stock_${s}` as Columna);
        if (!/^\d{1,7}$/.test(t)) falla(`stock_${s}`, 'El stock es un número entero de 0 en adelante.');
        else {
          pais.stock = Number(t);
          alguno = true;
        }
      }
      if (alguno) paises.push(pais);
    }
    if (paises.length) variante.countries = paises;
    variantes.push(variante);
  }

  const payload: FilaImportacion = { product: producto, variants: variantes };
  if (categorias) payload.category_ids = categorias;
  if (paisesProducto.size) payload.countries = [...paisesProducto].map(([country_code, is_visible]) => ({ country_code, is_visible }));
  if (nombresOpcion.size) {
    payload.options = [...nombresOpcion].sort((a, b) => a[0] - b[0]).map(([k, name], i) => ({
      name,
      sort_order: i,
      values: (valoresOpcion.get(k) ?? []).map((value, j) => ({ value, sort_order: j })),
    }));
  }
  return payload;
}

// ---------------------------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------------------------

export type ProductoExportable = {
  bd: ProductoBd;
  marca: string;
  genero: string;
  familia: string;
  concentracion: string;
  categorias: string[];
};

const ETIQUETA_ESTADO_EXPORT: Record<EstadoProducto, string> = { draft: 'borrador', active: 'activo', archived: 'archivado' };

/** Encabezado + una fila por variante, con el mismo formato que acepta la importación. */
export function filasDeExportacion(productos: readonly ProductoExportable[]): string[][] {
  const salida: string[][] = [[...COLUMNAS]];
  for (const { bd, marca, genero, familia, concentracion, categorias } of productos) {
    const p = bd.product;
    const opciones = [...bd.options].sort((a, b) => a.sort_order - b.sort_order);
    const variantes = [...bd.variants].sort((a, b) => a.sort_order - b.sort_order);
    for (const v of variantes) {
      const celdas: Partial<Record<Columna, string>> = {
        sku: v.sku,
        producto_slug: p.slug,
        nombre: p.name,
        marca,
        genero,
        familia,
        concentracion,
        categorias: categorias.join('|'),
        notas_salida: p.notes_top.join('|'),
        notas_corazon: p.notes_heart.join('|'),
        notas_fondo: p.notes_base.join('|'),
        descripcion_corta: p.short_description ?? '',
        descripcion: p.description_html ?? '',
        peso_kg: String(Number(v.weight_kg)),
        mastershop_product_id: v.mastershop_product_id === null ? '' : String(v.mastershop_product_id),
        mastershop_variant_id: v.mastershop_variant_id === null ? '' : String(v.mastershop_variant_id),
        estado: ETIQUETA_ESTADO_EXPORT[p.status],
        por_defecto: v.is_default ? 'sí' : '',
      };
      opciones.slice(0, 2).forEach((o, k) => {
        const valor = o.values.find((x) => v.option_value_ids.includes(x.id));
        celdas[`opcion_${k + 1}_nombre` as Columna] = o.name;
        celdas[`opcion_${k + 1}_valor` as Columna] = valor?.value ?? '';
      });
      for (const pais of PAISES_PRODUCTO) {
        const s = pais.toLowerCase();
        const moneda = COUNTRY_CURRENCY[pais];
        const vp = v.countries.find((c) => c.country_code === pais);
        const pp = bd.countries.find((c) => c.country_code === pais);
        celdas[`visible_${s}` as Columna] = pp ? (pp.is_visible ? 'sí' : 'no') : '';
        if (vp) {
          celdas[`precio_${s}` as Columna] = montoATexto(vp.price, moneda);
          celdas[`tachado_${s}` as Columna] = montoATexto(vp.compare_at_price, moneda);
          celdas[`costo_${s}` as Columna] = montoATexto(vp.cost, moneda);
          celdas[`stock_${s}` as Columna] = String(vp.stock);
        }
      }
      salida.push(COLUMNAS.map((c) => neutralizarFormula(celdas[c] ?? '')));
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// Imágenes masivas: SKU_1.jpg (principal), SKU_2.jpg (cursor), SKU_3.jpg...
// ---------------------------------------------------------------------------------------------

export function parsearNombreImagen(nombre: string): { sku: string; posicion: number } | null {
  const base = nombre.split(/[\\/]/).pop() ?? '';
  const m = /^(.+)_(\d{1,2})\.(?:jpe?g|png|webp)$/i.exec(base);
  if (!m || base.startsWith('.')) return null;
  const posicion = Number(m[2]);
  return posicion >= 1 ? { sku: m[1] as string, posicion } : null;
}

type ImagenGuardada = { media_id: string; role: RolImagen; sort_order: number };

/** Aplica las imágenes nuevas sobre las del producto: 1 = principal, 2 = cursor, 3+ = galería (reemplaza ese lugar). */
export function fusionarImagenes(
  existentes: readonly ImagenGuardada[],
  nuevas: readonly { media_id: string; posicion: number }[],
): ImagenGuardada[] {
  const ordenadas = [...existentes].sort((a, b) => a.sort_order - b.sort_order);
  let principal = ordenadas.find((i) => i.role === 'primary')?.media_id;
  let hover = ordenadas.find((i) => i.role === 'hover')?.media_id;
  const galeria = ordenadas.filter((i) => i.role === 'gallery').map((i) => i.media_id);
  for (const n of [...nuevas].sort((a, b) => a.posicion - b.posicion)) {
    if (n.posicion === 1) principal = n.media_id;
    else if (n.posicion === 2) hover = n.media_id;
    else if (n.posicion - 3 < galeria.length) galeria[n.posicion - 3] = n.media_id;
    else galeria.push(n.media_id);
  }
  const lista: { media_id: string; role: RolImagen }[] = [];
  if (principal) lista.push({ media_id: principal, role: 'primary' });
  if (hover) lista.push({ media_id: hover, role: 'hover' });
  for (const g of galeria) lista.push({ media_id: g, role: 'gallery' });
  return normalizarImagenes(lista).map((i, k) => ({ ...i, sort_order: k }));
}
