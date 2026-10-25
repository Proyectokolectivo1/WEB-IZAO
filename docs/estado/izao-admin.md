# Bitácora izao-admin

## Hecho (hashes: `git log --grep "<tema>"`)
- Oleada 0: login /admin con MFA, roles, bloqueo, cookie propia (D-018, D-020, D-021). T2.5 imágenes (`lib/admin/media/`).
- T2.6 atributos, categorías, colecciones, productos (editor con variantes/imágenes), T2.7 importación CSV/Excel/ZIP, contenido/páginas, plantillas de WhatsApp.
- Integraciones (`/admin/integraciones`): credenciales cifradas, probar conexión, webhooks MasterShop. Activar usa `activarCredencialIntegracionDb` (RPC atómica, fa0f98b). Acción `integraciones.gestionar`.
- Pagos y países (`/admin/pagos`): country_settings y payment_method_settings. Acción `pagos.gestionar`.
- Pedidos (5b0dfc8 filtros, 2afe2ab acciones): filtros en URL (estado, país, método, fechas en UTC-5, número o celular ≥ 7 dígitos), atajos `/` `j` `k` Enter. Detalle con acciones (`lib/admin/pedidos/acciones-servidor.ts`, `app/admin/(panel)/pedidos/acciones.ts`):
  cancelar y marcar pagado (solo admin; `transicionar` + `aplicarEventoPedidoDb`; marcar pagado solo desde `pendiente_manual`, exige referencia, confirma stock y encola el envío; cancelar libera stock y, con envío en MasterShop 1–2, cancela allá primero; si el envío está en 3+ se rechaza), nota interna (evento `nota_interna`), Reintentar (`reintentarEnvioMasterShop`: encolado/ya_pendiente/estado_invalido), reimprimir con `requested_by=admin:<id>`. Insignias Novedad / Error transportadora / WhatsApp falló.
- Agente de impresión (36470e5): `/admin/agente-impresion` (estado por heartbeat, cola, página de prueba, reimprimir) y `/[id]` (admin: activar/desactivar, rotar token, `remote_config` print/panel/intervals + modo). Token solo en la respuesta de alta/rotación, en base solo `hashTokenAgente`. `lib/admin/agentes/{esquemas,estado,servidor}.ts`.
- Permisos probados en `acciones.test.ts` de pedidos y de agente (rol real vía `puede`).

- Descuentos e Influencers (5be63ab): `/admin/descuentos` (lista con filtros en URL país/estado/origen/código, `nuevo`, `[id]` con reporte de uso, `lote`), `/admin/influencers` (fichas, códigos y enlaces `/{pais}?ref=CODIGO`, `reporte` por rango con Excel). Acciones `descuentos.gestionar` e `influencers.gestionar` (solo admin). Lib en `lib/admin/descuentos/`; `lib/admin/excel/libro.ts` (xlsx multihoja, montos numéricos exactos), `lib/admin/metricas/{pedidos,filtros}.ts` (fila de `orders` a `PedidoMetrica`, filtro de fechas por URL) y `components/admin/FiltroFechas.tsx` quedan listos para el Dashboard. `adminParaApiDe(modulo, accion)` en `crud/servidor.ts` para descargas.
- Métricas (feat dashboard): `/admin/metricas` (país Todos/CO/EC, `FiltroFechas`, comparación con periodo anterior), KPIs de §21.3, gráfica SVG propia, embudo, métodos de pago, panel por estado de guía con enlaces a `/admin/pedidos?estado|guia|grupo|novedad` (filtros nuevos en pedidos), tops (ciudades, departamentos, productos con utilidad, códigos, influencers, fuentes UTM) y Excel de 8 hojas `/api/admin/metricas/exportar`. Calcula desde `orders` (+líneas, envío, pagos embebidos; paginado de a 1 000) con `lib/admin/metricas/{dashboard,servidor,kpis,excel,formato,pais}.ts` y las fórmulas de `@izao/core/metrics`. Acción `metricas.exportar` (solo admin).
- Garantías (1f4ae18): `/admin/garantias` (bandeja, pestañas con conteo, vencidas), `[id]` (fotos, pedido, historial, gestión: flujo de estados validado, costo en entero, update atómico con control por `updated_at`), `ajustes` (solo admin, `garantias.ajustes`: plazo, respuesta, motivos, HTML depurado, caché `content:{país}`). `lib/admin/garantias/`.
- Gastos (8619aab): `/admin/gastos` (país, fechas, categoría, origen; totales por categoría; Excel), `[id]`/`nuevo` (solo manuales; meta_ads y billetera = solo lectura), `categorias` (pauta_* cuenta para ROAS; sistema/con gastos no se borran). Acción `gastos.gestionar` (solo admin). `lib/admin/gastos/`.


## Pendiente
- Dashboard: leer KPIs y serie diaria de `daily_sales_stats` (ya tiene las columnas, migración 20261025 + job `metrics.recompute_day`) y dejar `orders` solo para tops, panel de guías y hoja Pedidos; caché Redis 5 min de los tops; verificar < 1,5 s con 12 meses. Hoy lee `orders` completo del rango (tope 50 000 por consulta, avisa si es parcial).
- Gastos: adjunto opcional (falta `media.kind='expense'`, pedir a izao-db) y botón "Sincronizar ahora" de Meta Ads (conector: izao-integraciones/worker).
- Garantías: formulario público `/{pais}/garantias` y correo de recepción (izao-tienda/izao-pagos); el video del caso no se lista (solo en disco).
- Pedidos: filtros por ciudad, código, influencer, documento (§24.1); acciones masivas; "devolver stock" tras entregado/devuelto.
- Agente: capturas de error no se muestran; editor visual de pasos del modo panel (hoy JSON validado).
- Integraciones: esquemas de Addi, Sistecrédito, OpenRouter, Meta Ads y píxeles. `.env.example`: `INTEGRACIONES_MODO`, `SITE_URL`, `MASTERSHOP_WEBHOOK_PATH_SECRET` (infra).
- Para izao-db (opcional): RPC `admin_publicar_pagina`; RPC cancelar+liberar stock en una transacción.
- Falta prueba de humo en navegador (no hay Supabase/MFA local).

## Decisiones / avisos
- Sin `react-hook-form`: `useActionState` + zod del servidor. `cliente-falso` devuelve `filtros` y soporta `or`.
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar `permissions.test.ts`. Pruebas de vitest solo `*.test.ts` (JSX: `createElement` + `globalThis.React`).
- Heredocs de bash pierden barras invertidas; escribir archivos con Write. Cancelar con envío MasterShop 3+ se rechaza a propósito.

## Punto de retoma
Dashboard, Garantías y Gastos cerrados (web: lint, tsc y 954 pruebas verdes). Siguiente paso exacto: 5) Usuarios y roles (`usuarios`, `disponible: false`), 6) Apariencia; antes, opcional, mover el dashboard a `daily_sales_stats` (ver Pendiente).

## Avisos al líder
- La tienda aún no procesa `?ref=CODIGO` (cookie 30 días, aplicar código, `orders.influencer_id`): izao-tienda/izao-pagos.
- Fuente de venta: el dashboard lee `orders.utm.utm_source|source` y `click_ids` (fbclid/gclid/ttclid); izao-tienda debe guardar esas claves.
