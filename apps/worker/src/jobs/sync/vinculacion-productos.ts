/**
 * Vinculación de variantes con MasterShop por SKU, **por país** (D-050, D-052). Cada país tiene su propia cuenta de
 * MasterShop (otra llave, otros ids): lee `GET /api/products` + `GET /api/products/{id}?includeAllVariations=true`
 * con la llave del país y las filas `variant_countries` de ese país, y propone el vínculo
 * (`variant_countries.mastershop_product_id/_variant_id`). La escritura (opcional, `aplicar`) solo llena filas del
 * país que siguen sin vínculo; nunca toca `product_variants.mastershop_*` (espejo deprecado de CO que mantienen los
 * triggers). Un país sin llave no frena al otro.
 */
import { currencyForCountry, type CountryCode } from '@izao/core/money';
import {
  emparejarPorSku,
  MasterShopClient,
  parseMasterShopCredentials,
  type Emparejamiento,
  type MasterShopCredentials,
  type MasterShopProduct,
  type VarianteIzao,
  type VistaPreviaVinculacion,
} from '@izao/mastershop';
import { crearClientePostgrest, eq, type Fila, type OpcionesPostgrest } from '../postgrest.js';

export interface FuenteVinculacion {
  /** Llave activa de MasterShop del país; `null` si no hay. */
  credenciales(pais: CountryCode): Promise<MasterShopCredentials | null>;
  /** Variantes con fila en `variant_countries` del país, con el vínculo de ese país. */
  variantes(pais: CountryCode): Promise<VarianteIzao[]>;
  /** Escribe el vínculo propuesto solo en filas del país aún sin vínculo; devuelve cuántas cambió. */
  guardarVinculos(pais: CountryCode, nuevas: readonly Emparejamiento[]): Promise<number>;
}

export interface DepsVinculacion {
  fuente: Pick<FuenteVinculacion, 'credenciales' | 'variantes'> & Partial<Pick<FuenteVinculacion, 'guardarVinculos'>>;
  /** Para pruebas: cliente contra el *mock*. */
  crearCliente?: (c: MasterShopCredentials, pais: CountryCode) => Pick<MasterShopClient, 'listAllProductsWithVariants'>;
}

export interface ResultadoVinculacion {
  vista: VistaPreviaVinculacion;
  productos: MasterShopProduct[];
}

export type ResultadoVinculacionPais =
  | { accion: 'sin_credenciales' }
  | { accion: 'vista_previa'; vista: VistaPreviaVinculacion }
  | { accion: 'aplicado'; vista: VistaPreviaVinculacion; vinculadas: number }
  | { accion: 'error'; error: string };

/** Vista previa de un país con su propia llave. Lanza si el país no tiene llave activa. */
export async function vistaPreviaVinculacion(deps: DepsVinculacion, pais: CountryCode = 'CO'): Promise<ResultadoVinculacion> {
  const cred = await deps.fuente.credenciales(pais);
  if (cred === null) throw new Error(`No hay credencial activa de MasterShop para ${pais}.`);
  const cliente = deps.crearCliente?.(cred, pais) ?? new MasterShopClient({ apiKey: cred.apiKey, currency: currencyForCountry(pais) });
  const [productos, variantes] = await Promise.all([cliente.listAllProductsWithVariants(), deps.fuente.variantes(pais)]);
  return { vista: emparejarPorSku(variantes, productos), productos };
}

/**
 * Recorre los países, cada uno con su llave. Sin llave → `sin_credenciales`; un error en un país queda en su
 * resultado (sin el mensaje del proveedor, que podría traer datos) y no impide revisar los demás. Con `aplicar`
 * escribe las `nuevas` de cada país (conflictos y sugerencias nunca se escriben).
 */
export async function vinculacionPorPais(
  deps: DepsVinculacion,
  opciones: { paises: readonly CountryCode[]; aplicar?: boolean },
): Promise<Partial<Record<CountryCode, ResultadoVinculacionPais>>> {
  const out: Partial<Record<CountryCode, ResultadoVinculacionPais>> = {};
  for (const pais of opciones.paises) {
    try {
      if ((await deps.fuente.credenciales(pais)) === null) {
        out[pais] = { accion: 'sin_credenciales' };
        continue;
      }
      const { vista } = await vistaPreviaVinculacion(deps, pais);
      if (!opciones.aplicar) {
        out[pais] = { accion: 'vista_previa', vista };
        continue;
      }
      if (!deps.fuente.guardarVinculos) throw new Error('La fuente no permite escribir vínculos.');
      const vinculadas = vista.nuevas.length === 0 ? 0 : await deps.fuente.guardarVinculos(pais, vista.nuevas);
      out[pais] = { accion: 'aplicado', vista, vinculadas };
    } catch (e) {
      out[pais] = { accion: 'error', error: e instanceof Error ? e.name : 'error' };
    }
  }
  return out;
}

const idONull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

/** Fila de `variant_countries` con `product_variants(sku, products(name))` embebido. */
export function aVarianteIzao(r: Fila): VarianteIzao {
  const variante = r.product_variants as { sku?: unknown; products?: { name?: unknown } | null } | null | undefined;
  const prod = variante?.products;
  return {
    variant_id: String(r.variant_id),
    sku: typeof variante?.sku === 'string' ? variante.sku : '',
    product_name: typeof prod?.name === 'string' ? prod.name : '',
    mastershop_product_id: idONull(r.mastershop_product_id),
    mastershop_variant_id: idONull(r.mastershop_variant_id),
  };
}

const LOTE = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crearFuenteVinculacionPostgrest(o: OpcionesPostgrest): FuenteVinculacion {
  const c = crearClientePostgrest(o);
  return {
    async credenciales(pais) {
      const cred = await c.credencial('mastershop', pais, 'vinculacion');
      return cred ? parseMasterShopCredentials(cred.valores) : null;
    },
    async variantes(pais) {
      const out: VarianteIzao[] = [];
      // PostgREST corta en 1000 filas: se pagina por `variant_id` (estable) hasta un lote incompleto.
      for (let offset = 0; ; offset += LOTE) {
        const rows = await c.filas(
          'variant_countries',
          `variant_countries?country_code=${eq(pais)}` +
            '&select=variant_id,mastershop_product_id,mastershop_variant_id,product_variants!inner(sku,products(name))' +
            `&order=variant_id.asc&limit=${LOTE}&offset=${offset}`,
        );
        out.push(...rows.map(aVarianteIzao).filter((v) => v.sku !== ''));
        if (rows.length < LOTE) return out;
      }
    },
    async guardarVinculos(pais, nuevas) {
      let cambiadas = 0;
      for (const e of nuevas) {
        if (!UUID.test(e.variant_id)) throw new Error('variant_id inválido');
        const { idProduct, idVariant } = e.propuesto;
        if (!Number.isSafeInteger(idProduct) || idProduct <= 0 || !Number.isSafeInteger(idVariant) || idVariant <= 0) {
          throw new Error('ID de MasterShop inválido');
        }
        // Idempotente: solo la fila del país que sigue sin vínculo (una segunda corrida no cambia nada).
        const r = (await c.pedir(
          'variant_countries',
          `variant_countries?variant_id=${eq(e.variant_id)}&country_code=${eq(pais)}` +
            '&mastershop_product_id=is.null&mastershop_variant_id=is.null&select=variant_id',
          {
            method: 'PATCH',
            headers: { prefer: 'return=representation' },
            body: JSON.stringify({ mastershop_product_id: idProduct, mastershop_variant_id: idVariant }),
          },
        )) as unknown[] | null;
        cambiadas += Array.isArray(r) ? r.length : 0;
      }
      return cambiadas;
    },
  };
}
