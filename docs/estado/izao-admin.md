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

## Pendiente
- Pedidos: filtros por ciudad, código, influencer, novedad, guía/documento (§24.1); acciones masivas; "devolver stock" tras entregado/devuelto no existe.
- Agente: capturas de error del agente (§24.1) no se muestran; editor visual de pasos del modo panel (hoy JSON validado).
- Integraciones: esquemas de Addi, Sistecrédito, OpenRouter, Meta Ads y píxeles. `.env.example` debe documentar `INTEGRACIONES_MODO`, `SITE_URL`, `MASTERSHOP_WEBHOOK_PATH_SECRET` (infra).
- Para izao-db (opcional): RPC `admin_publicar_pagina`; RPC que cancele+libere stock en una transacción.
- Falta prueba de humo en navegador (no hay Supabase/MFA local); importación síncrona por lotes.

## Decisiones / avisos
- Sin `react-hook-form`: formularios con `useActionState` + zod del servidor. `cliente-falso` ahora también devuelve `filtros` (eq/gte/lt…).
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar `permissions.test.ts`.
- Heredocs de bash pierden barras invertidas; escribir archivos con Write.
- Cancelar con envío en MasterShop 3+ se rechaza a propósito: se cancela allá y el webhook sincroniza.

## Punto de retoma
Descuentos+Influencers cerrados (web: lint, tsc y 859+ pruebas verdes). Siguiente paso exacto: 2) Dashboard `/admin/metricas` (poner `dashboard.disponible: true`, actualizar `permissions.test.ts`): leer `orders` del rango (patrón de `reporteInfluencers`, 2 consultas paid_at/created_at + `payments` aprobados + `shipments.shipping_rate` + `country_settings`), `aPedidoMetrica` → `filasVentasDiarias` por día/país → `resumenPais`/`consolidarEnCop`/`serieDiaria`; tráfico, gastos y garantías de sus tablas; Excel con `crearLibroXlsx`. Luego 3) Garantías (hoy `EnConstruccion`), 4) Gastos, 5) Usuarios y roles, 6) Apariencia.

## Avisos al líder
- `FilaVentasDiarias` del núcleo trae columnas que `daily_sales_stats` NO tiene (`orders_abandoned`, `confirmed_revenue`, `carrier_platform_fees`, `shipping_estimated_count`) y no existe el job `metrics.recompute_day`: pedir a izao-db la migración y a izao-pagos/infra el job; mientras tanto el Dashboard calcula desde `orders`.
- La tienda aún no procesa `?ref=CODIGO` (cookie 30 días, aplicar código y fijar `orders.influencer_id`): pendiente de izao-tienda/izao-pagos.
- En el árbol hay fallos ajenos: `@izao/addi#typecheck` y `@izao/sistecredito#test`.
