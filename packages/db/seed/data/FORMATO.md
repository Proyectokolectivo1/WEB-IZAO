# Formato de los archivos de datos del seed

Los lee `packages/db/seed/build-data-sql.mjs`, que los valida y genera SQL idempotente. Todos son JSON UTF-8 sin BOM.
El seed base (países, monedas, ajustes, páginas legales, plantillas de WhatsApp) vive en `packages/db/supabase/seed.sql`
y debe aplicarse antes.

```
node packages/db/seed/build-data-sql.mjs --check            # solo valida y muestra conteos
node packages/db/seed/build-data-sql.mjs > data.sql         # genera el SQL (una transacción)
node packages/db/seed/build-data-sql.mjs --only=geo,taxonomias,productos --offset=0 --limit=100
node packages/db/seed/build-data-sql.mjs --prune            # además quita vínculos que ya no estén en los archivos
```

Reglas generales:

- **Dinero:** enteros en unidad menor. COP en pesos (exponente 0); USD en centavos (49,90 USD = `4990`). Nunca decimales.
- **Idempotente:** upsert por clave natural y solo escribe cuando el valor cambia; una segunda corrida no modifica ninguna fila.
  `catalog_listing` se recalcula por lote al final, solo para los productos que cambiaron.
- **No borra productos** que falten en los archivos. `--prune` solo elimina vínculos (países, categorías, precios por país) de los
  productos presentes en los archivos.
- **Regla 7:** el cargador rechaza `name`, `short_description` o `description_html` con *original, auténtic\*, certific\*, genuin\*,
  réplica, inspirad\*, clon u oficial*.
- Las claves de país en minúscula (`co`, `ec`); en la base quedan como `CO`, `EC`.

## Geografía: `{co,ec}/regions.json` y `{co,ec}/cities.json`

```json
// regions.json
[{ "code": "05", "name": "Antioquia" }]
// cities.json
[{ "code": "05001", "region_code": "05", "name": "MEDELLÍN", "is_capital": true }]
```

- `code` único por país en regiones, y único por región en ciudades. `region_code` debe existir en `regions.json`.
- **Los nombres de ciudades vienen en MAYÚSCULAS**, tal cual DANE (Colombia) e INEC (Ecuador). Se cargan así; el formato de
  presentación (mayúsculas o minúsculas) se decide en la interfaz. Los nombres de departamentos y provincias van en capitalización normal.
- Colombia: 33 departamentos (incluye Bogotá, D.C.) y 1.122 municipios. Ecuador: 24 provincias y 221 cantones.

## Taxonomías: `taxonomias/*.json`

Todas con `slug` (minúsculas, números y guiones) y `name`. `sort_order` es opcional (por defecto el orden del archivo).

| Archivo | Campos adicionales |
|---|---|
| `genders.json` | `sort_order` |
| `concentrations.json` | `sort_order` |
| `olfactory_families.json` | `description`, `sort_order` |
| `brands.json` | `description` (sin logos ni imágenes de marcas) |
| `categories.json` | `parent_slug` (máximo 2 niveles), `description`, `seo_title`, `seo_description`, `sort_order`, `show_in_menu`, `countries` |

`categories[].countries` es opcional: `{ "co": { "is_visible": true, "sort_order": 1 }, "ec": { ... } }`. Si falta, la categoría es
visible en ambos países.

## Productos: `productos.json`

Lista de productos; cada uno con sus variantes y su bloque por país.

```json
{
  "slug": "sendero-intenso",
  "name": "Sendero Intenso",
  "short_description": "…",
  "description_html": "<p>…</p>",
  "brand_slug": "lumen-y-cedro",
  "gender_slug": "hombre",
  "family_slug": "frutal",
  "concentration_slug": "edt",
  "category_slugs": ["hombre"],
  "notes_top": ["melón"], "notes_heart": ["pera"], "notes_base": ["almizcle"],
  "occasion": ["cita"], "season": ["verano"],
  "longevity": "baja | media | alta | muy_alta",
  "sillage": "baja | media | alta | muy_alta",
  "attributes": {},
  "seo_title": null, "seo_description": null,
  "status": "draft | active | archived",
  "countries": {
    "co": { "visible": true, "is_featured": false, "featured_rank": null, "badges": ["nuevo"], "published_at": "2026-10-01T00:00:00Z" },
    "ec": { "visible": true, "is_featured": false, "featured_rank": null, "badges": [], "published_at": "2026-10-01T00:00:00Z" }
  },
  "options": [{ "name": "Presentación", "values": ["30 ml", "100 ml"] }],
  "variants": [
    {
      "sku": "IZ-0001-30",
      "option_values": { "Presentación": "30 ml" },
      "weight_kg": 0.3,
      "is_default": true,
      "mastershop_product_id": null,
      "mastershop_variant_id": null,
      "countries": {
        "co": { "active": true, "price": 209000, "compare_at_price": null, "cost": 81000, "stock": 15 },
        "ec": { "active": true, "price": 5315, "compare_at_price": null, "cost": 2640, "stock": 2 }
      }
    }
  ]
}
```

- **Un país ausente en `countries`** significa que el producto (o la variante) no existe en ese país. Un producto `draft` puede traer
  `"countries": {}`.
- `visible` es obligatorio y booleano. `featured_rank` es 1–999999 o `null`; `badges` son textos en minúscula (`nuevo`, `hot_sale`, `combo`).
- `price`, `compare_at_price`, `cost` y `stock` son enteros ≥ 0 (`compare_at_price` y `cost` pueden ser `null`).
- Cada variante declara un valor por cada opción del producto y como máximo una variante por producto es `is_default` (la base lo impone con un índice único parcial).
- `sku` es único en todo el archivo. La descripción es común a los países; precio, tachado, costo, stock y visibilidad son por país.
- Una variante colombiana sin vínculo a MasterShop (`mastershop_*_id` nulos) no puede publicarse en producción: la validación del panel
  lo exige; en los datos de prueba va en `null`.
