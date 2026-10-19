---
name: izao-panel-admin
description: Úsala al crear o modificar cualquier módulo del panel /admin de Izao (productos, categorías, banners, pop-ups, descuentos, pedidos, garantías, gastos, apariencia, usuarios, etc.), sus permisos por rol, importación/exportación o auditoría.
---

# Panel de administración de Izao

Referencia: `docs/ESPECIFICACION.md` §24 (módulos y permisos), §9 (contenido), §17–19.

## Estructura

- Rutas en `apps/web/app/admin/(modulos)/…`. Layout con barra lateral, selector de país arriba (afecta todo lo que es por país) y buscador global (pedido, cliente, SKU).
- Acceso: Supabase Auth + fila en `admin_users`. Middleware verifica rol en cada ruta y cada Server Action. MFA TOTP obligatoria para `admin`.
- Roles: `admin` (todo) y `operator` (pedidos operativos, garantías, agente). Matriz exacta en §24.3; implementar como mapa `permissions.ts` en `packages/core` y probarlo.

## Patrón de cada módulo

1. Lista con tabla paginada en servidor, filtros en la URL, búsqueda, acciones masivas cuando apliquen.
2. Formulario con `react-hook-form` + esquema `zod` compartido con el servidor.
3. Guardado por Server Action que: valida, verifica permiso, escribe en una transacción, registra en `audit_log` (diff antes/después), invalida las etiquetas de caché afectadas y devuelve errores por campo.
4. Vista previa cuando el resultado es visual (banners, pop-ups, apariencia, home, plantillas de WhatsApp).
5. Confirmación explícita para acciones destructivas o irreversibles (cancelar pedido, borrar, anonimizar cliente).

## Reglas

- Ningún valor de negocio queda fijo en código: si una pantalla de la tienda depende de un número o texto, ese número o texto se edita aquí.
- Las variantes se publican en Colombia solo si tienen `mastershop_product_id` (validación de servidor).
- Las credenciales se muestran enmascaradas; nunca se reenvían completas al navegador.
- Fechas en zona `America/Bogota`. Montos con el formato de la moneda del país seleccionado.
- Estados vacíos útiles ("Aún no hay banners para Ecuador. Crear el primero").

## Importación de catálogo

Plantilla de §24.2 (CSV y Excel). Flujo: subir → simulación con reporte (filas nuevas, cambios, errores por fila) → confirmar → ejecución en el worker con progreso → refresco de `catalog_listing` por lote. Exportación con el mismo formato. Imágenes masivas por nombre `SKU_n`.

## Pedidos (vista operativa)

Línea de tiempo desde `order_events`; bloques de pago, WhatsApp, envío y etiqueta; acciones de §24.1 con su permiso; insignias de "Novedad", "Error transportadora", "WhatsApp falló".

## Calidad

Tablas usables en tablet (operador en bodega). Atajos de teclado en pedidos (`/` buscar, `j/k` navegar). Ninguna pantalla del panel tarda más de 1,5 s en cargar con datos reales.
