# Bitácora izao-admin

## Hecho (hashes: `git log --grep "<tema>"`)
- Oleada 0: login /admin con MFA, roles, bloqueo, cookie propia (D-018, D-020, D-021). T2.5 imágenes (`lib/admin/media/`).
- T2.6 atributos, categorías, colecciones, productos (editor con variantes/imágenes), T2.7 importación CSV/Excel/ZIP, contenido/páginas, plantillas de WhatsApp.
- Integraciones (`/admin/integraciones`): credenciales cifradas, probar conexión, webhooks MasterShop. Activar usa `activarCredencialIntegracionDb` (RPC atómica, fa0f98b). Acción `integraciones.gestionar`.
- Pagos y países (`/admin/pagos`): country_settings y payment_method_settings. Acción `pagos.gestionar`.
- Pedidos (5b0dfc8 filtros, 2afe2ab acciones): filtros en URL (estado, país, método, fechas en UTC-5, número o celular ≥ 7 dígitos), atajos `/` `j` `k` Enter. Detalle con acciones (`lib/admin/pedidos/acciones-servidor.ts`, `app/admin/(panel)/pedidos/acciones.ts`):
  cancelar y marcar pagado (solo admin; `transicionar` + `aplicarEventoPedidoDb`; marcar pagado solo desde `pendiente_manual`, exige referencia, confirma stock y encola el envío; cancelar libera stock y, con envío en MasterShop 1–2, cancela allá primero; si el envío está en 3+ se rechaza), nota interna (evento `nota_interna`), Reintentar (`reintentarEnvioMasterShop`: encolado/ya_pendiente/estado_invalido), reimprimir con `requested_by=admin:<id>`. Insignias Novedad / Error transportadora / WhatsApp falló.
- Agente de impresión (36470e5): `/admin/agente-impresion` (estado por heartbeat, cola, página de prueba, reimprimir) y `/[id]` (admin: activar/desactivar, rotar token, `remote_config` print/panel/intervals + modo). Token solo en la respuesta de alta/rotación, en base solo `hashTokenAgente`. `lib/admin/agentes/{esquemas,estado,servidor}.ts`.
- Descuentos e Influencers (5be63ab): `/admin/descuentos` (lista con filtros en URL país/estado/origen/código, `nuevo`, `[id]` con reporte de uso, `lote`), `/admin/influencers` (fichas, códigos y enlaces `/{pais}?ref=CODIGO`, `reporte` por rango con Excel). Acciones `descuentos.gestionar` e `influencers.gestionar` (solo admin). Lib en `lib/admin/descuentos/`; `lib/admin/excel/libro.ts` (xlsx multihoja, montos numéricos exactos), `lib/admin/metricas/{pedidos,filtros}.ts` (fila de `orders` a `PedidoMetrica`, filtro de fechas por URL) y `components/admin/FiltroFechas.tsx` quedan listos para el Dashboard. `adminParaApiDe(modulo, accion)` en `crud/servidor.ts` para descargas.
- Métricas (feat dashboard): `/admin/metricas` (país Todos/CO/EC, `FiltroFechas`, comparación con periodo anterior), KPIs de §21.3, gráfica SVG propia, embudo, métodos de pago, panel por estado de guía con enlaces a `/admin/pedidos?estado|guia|grupo|novedad` (filtros nuevos en pedidos), tops (ciudades, departamentos, productos con utilidad, códigos, influencers, fuentes UTM) y Excel de 8 hojas `/api/admin/metricas/exportar`. Calcula desde `orders` (+líneas, envío, pagos embebidos; paginado de a 1 000) con `lib/admin/metricas/{dashboard,servidor,kpis,excel,formato,pais}.ts` y las fórmulas de `@izao/core/metrics`. Acción `metricas.exportar` (solo admin).
- Garantías (1f4ae18): `/admin/garantias` (bandeja, pestañas con conteo, vencidas), `[id]` (fotos, pedido, historial, gestión: flujo de estados validado, costo en entero, update atómico con control por `updated_at`), `ajustes` (solo admin, `garantias.ajustes`: plazo, respuesta, motivos, HTML depurado, caché `content:{país}`). `lib/admin/garantias/`.
- Gastos (8619aab): `/admin/gastos` (país, fechas, categoría, origen; totales por categoría; Excel), `[id]`/`nuevo` (solo manuales; meta_ads y billetera = solo lectura), `categorias` (pauta_* cuenta para ROAS; sistema/con gastos no se borran). Acción `gastos.gestionar` (solo admin). `lib/admin/gastos/`.
- Usuarios (5916edd): `/admin/usuarios` (lista con correo y MFA de Auth), `[id]`/`nuevo` (alta con ventana MFA 24 h, rol/estado, cambiar contraseña, reiniciar MFA). No adopta cuentas existentes (script `crear-admin`); nadie se degrada/desactiva a sí mismo y queda ≥ 1 admin activo. Contraseñas nunca a auditoría. Acción `usuarios.gestionar`. `lib/admin/usuarios/`.
- Apariencia (4a007c7): `/admin/apariencia?alcance=global|CO|EC` — 8 colores con contraste WCAG calculado (bloquea cuerpo < 4.5:1 salvo aceptación), pareja §8.2, tamaño, peso y espaciados, logo/favicon/nombre (solo global), override por país en `theme_overrides`, vista previa en vivo con las fuentes `--font-par{N}-*`. Reusa `@izao/ui/tema`. Acción `apariencia.gestionar`. `lib/admin/apariencia/`.
- Clientes (feat clientes): `/admin/clientes` (búsqueda correo/celular/documento/nombre, país, anonimizados), `[id]` (datos, pedidos incl. invitado por celular/correo, anonimizar). Anonimizar (habeas data) neutraliza pedidos/garantías/WhatsApp/leads/direcciones/deseos/chat/cuenta; conserva montos y fechas; se niega con pedidos o garantías en curso; pasos idempotentes con la marca al final (sin RPC atómica); auditoría sin datos personales. `clientes.gestionar`. `lib/admin/clientes/`.
- Sistema (feat sistema): `/admin/sistema` (colas BullMQ con conteos y fallidos + reintento, errores recientes, filas por tabla) y `/auditoria` (filtros, oculta accesos). `sistema.reintentar_job`. `lib/admin/sistema/`.

## Pendiente
- Dashboard: `daily_sales_stats` ya tiene columnas y job, pero los tops/panel/hoja Pedidos necesitan `orders`; para < 1,5 s con 12 meses pedir a izao-db RPC de tops (ciudades, productos, códigos, fuentes, estados de guía) y luego pasar KPIs/serie a la tabla; caché Redis 5 min. Hoy lee `orders` del rango (tope 50 000, avisa si es parcial).
- Gastos: adjunto opcional (falta `media.kind='expense'`, pedir a izao-db) y botón "Sincronizar ahora" de Meta Ads (conector: izao-integraciones/worker).
- Garantías: formulario público `/{pais}/garantias` y correo de recepción (izao-tienda/izao-pagos); el video del caso no se lista (solo en disco).
- Pedidos: filtros por ciudad, código, influencer, documento (§24.1); acciones masivas; "devolver stock" tras entregado/devuelto.
- Integraciones: esquemas de Addi, Sistecrédito, OpenRouter, Meta Ads y píxeles. `.env.example`: `INTEGRACIONES_MODO`, `SITE_URL`, `MASTERSHOP_WEBHOOK_PATH_SECRET` (infra).
- Para izao-db: RPC `admin_publicar_pagina`, cancelar+liberar stock atómico, anonimizar cliente atómico. Agente: sin capturas de error ni editor visual del modo panel.
- Falta prueba de humo en navegador (no hay Supabase/MFA local).

## Decisiones / avisos
- Sin `react-hook-form`: `useActionState` + zod del servidor. `cliente-falso` devuelve `filtros` y soporta `or`.
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar `permissions.test.ts`. Pruebas de vitest solo `*.test.ts` (JSX: `createElement` + `globalThis.React`).
- Heredocs de bash pierden barras invertidas; escribir archivos con Write. Cancelar con envío MasterShop 3+ se rechaza a propósito.

## Punto de retoma
Cerrados: Dashboard, Garantías, Gastos, Usuarios, Apariencia, Clientes y Sistema (web: lint, tsc y 1 065 pruebas verdes). Siguiente según prioridad del líder: Home (orden/activación de secciones por país), Reseñas (moderación), Leads (lista y exportación), Chatbot al final. Cada uno: poner `disponible: true` en `permissions.ts` y actualizar `permissions.test.ts`.

## Avisos al líder
- La tienda aún no procesa `?ref=CODIGO` (cookie 30 días, aplicar código, `orders.influencer_id`): izao-tienda/izao-pagos.
- Fuente de venta: el dashboard lee `orders.utm.utm_source|source` y `click_ids` (fbclid/gclid/ttclid); izao-tienda debe guardar esas claves.
