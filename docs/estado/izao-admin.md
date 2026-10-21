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

- Plantillas WhatsApp (módulo `whatsapp`, acción `whatsapp.plantillas`, solo admin): `/admin/whatsapp/plantillas[/id]`; `lib/admin/whatsapp/{etiquetas,plantillas,plantillas-servidor,credenciales}.ts`. Lista por país/clave/versión con estado y `meta_rejection_reason`; borrador editable con `variables_map` (selector por posición), vista previa, validación con `validarPlantilla`; "Crear versión nueva" (`nombreVersion`), "Crear con texto por defecto" (`PLANTILLAS_SEMILLA`), "Enviar a Meta" (reserva draft→pending condicional, `solicitudCreacion` + `crearClienteWhatsApp`, revierte a draft si falla). Activación al aprobarse: la hace el job `whatsapp.evento`.
- Pedidos: lista y detalle `/admin/pedidos[/id]` (pagos, mensajes WhatsApp, línea de tiempo) con "Copiar link de cobro" (`pedidos.copiar_link_cobro`, audita, token solo bajo demanda) y "Reenviar cobro" (`pedidos.reenviar_cobro`; encola `cod.iniciar` con jobId `cod.iniciar.{pedido}`, tope 1/min, evento `cobro_reenvio_solicitado`). `lib/admin/pedidos/*`. Permisos: operador y admin (§24.3).

## Pendiente
- Pedidos: faltan filtros, cancelar, marcar pagado, notas, reintentar envío, reimprimir y atajos (`/`, `j/k`); lista solo busca por número.
- Para izao-pagos: "Reenviar cobro" no repite un mensaje ya enviado (`cod.iniciar` es idempotente: `cobro_abono` con estado distinto de `queued` = `ya_enviado`). Hace falta un job `cod.reenviar` (reenvía con el mismo token si el link sigue vigente, ignorando `ya_enviado`). Hoy el panel avisa y sugiere copiar el link.
- Para izao-pagos/db: `activar_plantilla_whatsapp` atómica ya pedida; cifrado de credenciales `whatsapp` (módulo Integraciones, aún no construido).
- Para el líder: `next.config.ts` no tiene `@izao/whatsapp` en `transpilePackages` (el build pasa hoy).
- T2.6c cerrada (a008f5d): `/admin/productos[/nuevo|/id]`, editor con variantes/imágenes/duplicar/archivar. Sin buscador MasterShop (ids a mano) hasta que izao-logistica exponga `GET /api/products`; falta editar el `alt` de una imagen ya subida.
- T2.7 cerrada (ver commit "T2.7"): `/admin/productos/importar`; API `/api/admin/catalogo/{importar,exportar,plantilla,imagenes}`; `lib/admin/catalogo/{csv,xlsx,zip,archivo,importacion,importacion-servidor}.ts`. Excel y ZIP sin dependencias (node:zlib) para no tocar package.json/lockfile; si se prefiere `exceljs`, solo cambia `xlsx.ts`.
- Contenido/páginas (módulo `contenido`, acción `contenido.gestionar`, solo admin): `/admin/contenido[/paginas[/id|nueva]]`; `lib/admin/contenido/paginas{,-servidor}.ts`. Elige `kind`; al publicar un tipo legal despublica (draft) la anterior del país+tipo y, si la escritura falla, la vuelve a publicar (NO es transacción de BD); `version` +1 al publicar o cambiar título/texto publicado; bloquea marcadores [COMPLETAR..]. Invalida el tag `content:{país}` (el que lee `repo-supabase`) con `invalidarContenido`. Editor = textarea HTML + vista previa depurada (sin TipTap: no instalado).
- Descripción y resumen de producto (`short_description`, `description_html`) se depuran con `depurarHtml` de `lib/store/html-seguro` al guardar y al importar.
- Falta: importación en el worker con progreso (hoy síncrona por lotes de 200, `maxDuration` 300 s); probar con un .xlsx real de Excel; prueba de humo en navegador (no hay Supabase/MFA local).
- Oleada 3 (pagos): impedir `payment_method_settings` activo con `cod_enabled` falso.

## Decisiones / avisos
- Para izao-db (opcional): RPC `admin_publicar_pagina` que despublique+publique en una transacción; hoy es compensación en el panel. `cliente-falso` acepta lista de respuestas por operación (se consumen en orden).
- Sin `react-hook-form` (no instalado): formularios con `useActionState` + zod del servidor.
- `apps/web/lib/db/` no existe: uso `crearClienteServicio()` con tipos locales.
- Categorías: guardar categoría + `category_countries` son 2 escrituras (no atómicas); un fallo del segundo se reporta y se puede reintentar.
- `npm build` falla hoy por `apps/web/lib/store/fuentes.ts` (spread en `next/font`, de izao-tienda); mis rutas compilan (build verde antes de ese cambio). Lint, typecheck y test en la raíz: verdes.
- `MEDIA_ROOT` sin definir usa `apps/web/.media-dev/`; las imágenes se sirven en `/media/<ruta>`.
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar la lista en `permissions.test.ts`.

## Punto de retoma
T2.6a/b/c/d y T2.7 cerradas y verdes (tsc de mis archivos, eslint, vitest 462). Siguiente: lo que asigne el líder (dashboard `izao-metricas`, T4.x) o los pendientes de arriba.
