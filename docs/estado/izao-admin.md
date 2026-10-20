# Bitácora izao-admin

## Hecho
- Oleada 0: login /admin con MFA, roles, bloqueo, cookie propia (D-018, D-020, D-021).
- T2.5 pipeline de imágenes (`lib/admin/media/`, `POST /api/admin/media`, sharp). `git log --grep T2.5`.
- T2.6 (hashes con `git log --grep "T2.6"`):
  - 609a915 atributos: marcas, familias, géneros, concentraciones -> `/admin/atributos/[tipo]/[id|nuevo]` (módulo `catalogo_auxiliar`).
  - 955e990 categorías (2 niveles, visibilidad/orden por país, imagen y banner) -> `/admin/categorias[/id|nueva]`.
  - 4425602 colecciones (manual con orden / por regla) y destacados por país -> `/admin/colecciones[/id|nueva|destacados]`.
- Piezas reutilizables: `lib/admin/crud/{comun,servidor,cliente-falso}.ts` (slug, errores por campo, `adminDeAccion(modulo, accion)`, `invalidarCatalogo/Producto`, `traducirErrorBd`, cliente Supabase falso para pruebas); `components/admin/{SelectorImagen,BotonConfirmar,Campo*,Paginacion,BuscadorLista,PestanasPais}`; `app/admin/crud.css`.
- Patrón por módulo: `lib/admin/catalogo/<x>.ts` (zod + lógica pura) + `<x>-servidor.ts` (BD + auditoría + invalidación, cliente inyectado) + pruebas con `clienteFalso` + `app/admin/(panel)/<ruta>/{page,[id]/page,acciones}.ts(x)`.
- Permisos: acciones `catalogo.gestionar` y `catalogo.importar` (solo admin). Módulos habilitados: atributos, categorías, colecciones (probado en `permissions.test.ts`).

## Pendiente
- T2.6c productos+variantes -> `/admin/productos` (módulo `productos`, aún `disponible:false`): lista con filtros en URL (q, estado, marca, país), formulario (datos, taxonomías, categorías, notas, SEO), opciones/valores, variantes con precio/tachado/costo/stock/umbral por país (`fromMajorString` con la moneda del país; BigInt), vínculo MasterShop (variante activa en CO + producto visible en CO sin `mastershop_*` no se publica: validar en zod/lib puro Y lo repite la RPC), imágenes principal/hover/galería con reordenar (SelectorImagen kind 'product', recorte45), duplicar y archivar (status 'archived'). Guardado vía RPC `admin_guardar_producto(p jsonb)` (contrato en el mensaje a izao-db y en docs/estado/izao-db.md; UUID de options/values/variants los genera la app). RPC aplicada (migración 20261020044538, commit 373d18d): usar `guardarProducto(entrada)` de `@/lib/db/admin-catalogo` (server-only; exporta `guardarProductoSchema`, `motivosAdminCatalogo`, tipos). Sección ausente = no se toca. `sin_vinculo_mastershop` exige solo `mastershop_product_id` y solo si el producto está `active`, visible en CO y la variante activa en CO (los 400 de prueba en CO no tienen vínculo: activarlos devuelve ese motivo). País de variante que deja de venir se borra (o se desactiva si tiene reservas). Construir primero lo puro (esquema, payload, validación de vínculo) con pruebas.
- T2.7 import/export CSV+Excel (`exceljs` en apps/web), `importarCatalogo('simular'|'aplicar', filas)` de `@/lib/db/admin-catalogo` (máx. 1000 filas por llamada; devuelve creados/actualizados/sin_cambios, `errores[{indice, sku, motivo}]` y `cambios[{indice, tipo, campos}]`; valida con `filaImportacionSchema`; detecta slug/sku repetidos; category_ids e images reemplazan si vienen), plantilla §24.2, imágenes masivas `SKU_1.jpg`/`SKU_2.jpg`.
- Oleada 3 (pagos): impedir `payment_method_settings` activo con `cod_enabled` falso.

## Decisiones / avisos
- Sin `react-hook-form` (no instalado): formularios con `useActionState` + zod del servidor.
- `apps/web/lib/db/` no existe: uso `crearClienteServicio()` con tipos locales.
- Categorías: guardar categoría + `category_countries` son 2 escrituras (no atómicas); un fallo del segundo se reporta y se puede reintentar.
- `npm build` falla hoy por `apps/web/lib/store/fuentes.ts` (spread en `next/font`, de izao-tienda); mis rutas compilan (build verde antes de ese cambio). Lint, typecheck y test en la raíz: verdes.
- `MEDIA_ROOT` sin definir usa `apps/web/.media-dev/`; las imágenes se sirven en `/media/<ruta>`.
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar la lista en `permissions.test.ts`.

## Punto de retoma
T2.6a/b/d cerradas y verdes. Siguiente: T2.6c productos (empezar por lo puro `lib/admin/catalogo/productos.ts` + pruebas; las RPC ya están aplicadas (373d18d), usar los envoltorios de `@/lib/db/admin-catalogo`), luego T2.7.
