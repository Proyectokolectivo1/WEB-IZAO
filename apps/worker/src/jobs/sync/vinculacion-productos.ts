/**
 * Vista previa de la vinculación de variantes con MasterShop por SKU. **Solo lee**: la base (llave de servidor) y
 * `GET /api/products` + `GET /api/products/{id}?includeAllVariations=true`. La escritura es el SQL de
 * `sqlVinculacion`, que aplica el dueño (o el panel) después de revisar la vista previa.
 */
import {
  emparejarPorSku,
  MasterShopClient,
  parseMasterShopCredentials,
  type MasterShopCredentials,
  type MasterShopProduct,
  type VarianteIzao,
  type VistaPreviaVinculacion,
} from '@izao/mastershop';
import { crearClientePostgrest, type Fila, type OpcionesPostgrest } from '../postgrest.js';

export interface FuenteVinculacion {
  credenciales(): Promise<MasterShopCredentials | null>;
  variantes(): Promise<VarianteIzao[]>;
}

export interface DepsVinculacion {
  fuente: FuenteVinculacion;
  /** Para pruebas: cliente contra el *mock*. */
  crearCliente?: (c: MasterShopCredentials) => Pick<MasterShopClient, 'listAllProductsWithVariants'>;
}

export interface ResultadoVinculacion {
  vista: VistaPreviaVinculacion;
  productos: MasterShopProduct[];
}

export async function vistaPreviaVinculacion(deps: DepsVinculacion): Promise<ResultadoVinculacion> {
  const cred = await deps.fuente.credenciales();
  if (cred === null) throw new Error('No hay credencial activa de MasterShop para CO.');
  const cliente = deps.crearCliente?.(cred) ?? new MasterShopClient({ apiKey: cred.apiKey });
  const [productos, variantes] = await Promise.all([cliente.listAllProductsWithVariants(), deps.fuente.variantes()]);
  return { vista: emparejarPorSku(variantes, productos), productos };
}

const idONull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

export function aVarianteIzao(r: Fila): VarianteIzao {
  const prod = r.products as { name?: unknown } | null | undefined;
  return {
    variant_id: String(r.id),
    sku: String(r.sku),
    product_name: typeof prod?.name === 'string' ? prod.name : '',
    mastershop_product_id: idONull(r.mastershop_product_id),
    mastershop_variant_id: idONull(r.mastershop_variant_id),
  };
}

const LOTE = 500;

export function crearFuenteVinculacionPostgrest(o: OpcionesPostgrest): FuenteVinculacion {
  const c = crearClientePostgrest(o);
  return {
    async credenciales() {
      const cred = await c.credencial('mastershop', 'CO', 'vinculacion');
      return cred ? parseMasterShopCredentials(cred.valores) : null;
    },
    async variantes() {
      const out: VarianteIzao[] = [];
      // PostgREST corta en 1000 filas: se pagina por `id` (estable) hasta un lote incompleto.
      for (let offset = 0; ; offset += LOTE) {
        const rows = await c.filas(
          'product_variants',
          `product_variants?select=id,sku,mastershop_product_id,mastershop_variant_id,products(name)&order=id.asc&limit=${LOTE}&offset=${offset}`,
        );
        out.push(...rows.map(aVarianteIzao));
        if (rows.length < LOTE) return out;
      }
    },
  };
}
