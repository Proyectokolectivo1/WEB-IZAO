# Bitácora izao-admin

## Hecho (hashes: `git log --grep "<tema>"`)
- Oleada 0: login /admin con MFA, roles, bloqueo, cookie propia (D-018, D-020, D-021). T2.5 imágenes (`lib/admin/media/`).
- T2.6 atributos, categorías, colecciones, productos (editor con variantes/imágenes), T2.7 importación CSV/Excel/ZIP, contenido/páginas, plantillas de WhatsApp (`/admin/whatsapp/plantillas`), pedidos lista/detalle con "Copiar link de cobro" y "Reenviar cobro" (`lib/admin/pedidos/*`).
- Integraciones (commit "módulo Integraciones"): `/admin/integraciones[/proveedor?pais&ambiente]`; `lib/admin/integraciones/{catalogo,sondas,credenciales-servidor}.ts`. Wompi, MasterShop y WhatsApp (esquema de cada paquete). Cifra con `cifrarCredenciales`; solo `masked_preview` sale al navegador; secreto en blanco = conservar; una sola activa por proveedor+país (activar = activa nueva y apaga otras, revierte si falla); probar conexión real o mock (`INTEGRACIONES_MODO=mock`, ignorado en producción); "Registrar webhooks" con `registrarWebhooksMasterShop`. Acción `integraciones.gestionar` (admin).
- Pagos y países (commit "módulo Pagos y países"): `/admin/pagos?pais=`; `lib/admin/pagos/{ajustes,ajustes-servidor}.ts`. country_settings (cod_enabled, abono, recaudo mín., vigencia link, recordatorios en horas, horario silencioso, `cod_resend_max` ≥ 0, recargo addi/sistecredito, TTLs, TRM solo EC, `carrier_wallet_low_balance`) y payment_method_settings; `cod` no se activa con `cod_enabled` falso y el país no se deshabilita con `cod` activo. Acción `pagos.gestionar` (admin). Invalida `checkout-config` + `content:{país}` (`invalidarConfigPais`).
- Permisos nuevos en `lib/auth/permissions.ts`: `integraciones.gestionar`, `pagos.gestionar`, `agente.gestionar` (solo admin; probados).
- Piezas reutilizables nuevas: `components/admin/{BotonAccion,FormularioCredencial,FormularioAjustesPais,FormularioMetodoPago}.tsx`.

## Pendiente
- (3) Pedidos: filtros, cancelar, marcar pagado, notas, "Reintentar" (`reintentarEnvioMasterShop(orderId, estado)`: encolado/ya_pendiente/estado_invalido), reimprimir con `requested_by=admin:<id>`, atajos `/` `j/k`. Permisos ya existen en `permissions.ts`.
- (4) Agentes de impresión: alta con token (`hashTokenAgente` de `app/api/agent/_lib/contrato.ts`, token visible una sola vez), activar/desactivar, editar `remote_config` (`print{copies,print_settings}`, `panel{...}` según `apps/print-agent/README.md`). Acción `agente.gestionar` ya definida; `/admin/agente-impresion` es la página actual (solo estado).
- Integraciones: faltan esquemas de Addi, Sistecrédito, OpenRouter, Meta Ads y píxeles (se agregan a `PROVEEDORES`). Falta que `.env.example` documente `INTEGRACIONES_MODO`, `SITE_URL` y `MASTERSHOP_WEBHOOK_PATH_SECRET` (infra).
- Para izao-db (opcional): índice único parcial `(provider, country_code) where is_active` en `integration_credentials` y RPC de activar atómica (hoy son 2 escrituras con reversión); RPC `admin_publicar_pagina`.
- Sin buscador MasterShop en productos; importación síncrona por lotes; falta prueba de humo en navegador (no hay Supabase/MFA local).

## Decisiones / avisos
- Sin `react-hook-form`: formularios con `useActionState` + zod del servidor. `cliente-falso` acepta lista de respuestas por operación.
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar la lista en `permissions.test.ts`.
- Las heredocs de bash pierden barras invertidas y se cortan con `''`: escribir archivos con la herramienta Write.

## Punto de retoma
Integraciones y Pagos cerrados y verdes (tsc, eslint de mis rutas, vitest). Siguiente: (3) pedidos, luego (4) agentes de impresión.
