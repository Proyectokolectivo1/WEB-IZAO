# Decisiones del proyecto

Registro de decisiones que ajustan o completan `docs/ESPECIFICACION.md`. Más reciente al final.

## D-001 — Región de Supabase (2026-10-18)

- El VPS de Contabo está en **Hub Europe**, IP `169.58.102.153` (dato dado por el dueño; sustituye el `[VERIFICAR]` de §4.1).
- El proyecto anterior `WEB-IZAO` (`jumzyidhxspeexzozufl`, `us-west-2`) estaba vacío y fue eliminado por el dueño. Siguiendo §6.0 se creó uno nuevo, también llamado `WEB-IZAO`, en `eu-central-1` (Fráncfort), la región de Supabase más cercana al VPS. Costo 0 USD/mes.
- **Referencia (ref) vigente: `wyxjmlgrcjclelbrluvd`** · URL `https://wyxjmlgrcjclelbrluvd.supabase.co` · Postgres 17.
- El proyecto `My Project` (`xschakcmelcqxwxbisiq`, `sa-east-1`) es ajeno a Izao: no se toca.

## D-002 — Pedidos `pendiente_manual` que vencen (2026-10-18)

§5.4 reserva el stock 24 h y §16 no definía el estado al vencer. Decisión del dueño: el pedido pasa a `expirado` y **se libera el stock**. Aplica a la transición `pendiente_manual → expirado` del `check` de estados de `orders`.

## D-003 — `daily_sales_stats` (2026-10-18)

La referencia "sección 21.3" en §6.2 es un error de numeración: la definición vigente es **§21.4**.

## D-004 — Supabase Realtime (2026-10-18)

§2 lo menciona pero ningún módulo lo usa. Se ignora; no se construye nada sobre Realtime.

## D-005 — F0 en dos tramos (2026-10-18)

- **F0a (local):** monorepo, Docker local, migraciones, RLS, seed, tipos, login admin con MFA, scripts de backup y restauración contra una base temporal local.
- **F0b (VPS):** despliegue con HTTPS, backup diario real y restauración de prueba. Depende del MCP `contabo`, el DNS y el `.env` en el VPS.
- El dueño indica que `https://www.izaoperfumeria.com/` ya apunta al servidor; `izao-infra` lo verifica en F0b con el inventario del VPS.

## D-006 — Esqueletos de aplicaciones (2026-10-18)

`izao-infra` crea el esqueleto de `apps/web` y `apps/worker`, con un `app/layout.tsx` y una página mínimos que pasan a `izao-tienda` en la Oleada 2. Los paquetes `core`, `ui` e `integrations` los crean sus dueños en su oleada. `izao-admin` se suma a la Oleada 0 para el login con MFA.

## D-007 — Acceso al VPS (2026-10-18)

El dueño compartió un comando `ssh` directo como root. Se mantiene la regla de `CLAUDE.md`: el VPS se opera solo con el MCP `contabo`, y `ssh`/`scp` siguen denegados en `.claude/settings.json`. Cambiar esa política es decisión del dueño, editando ese archivo. La llave de root solo se usa una vez, a mano, para `setup-vps.sh`; el MCP usa la llave dedicada del usuario `izao`.

## D-008 — Migraciones de Supabase (2026-10-18)

Se prefiere el MCP de Supabase (`apply_migration`, `execute_sql`, `get_advisors`, `generate_typescript_types`) sobre la CLI. Los archivos en `packages/db/supabase/migrations/` siguen siendo la fuente de verdad y se nombran con la versión que asigna Supabase (`list_migrations`); el SQL aplicado también queda en `supabase_migrations.schema_migrations.statements`. Si hace falta la CLI (por ejemplo para `pgtap` local), se instala como dependencia de desarrollo.

## D-009 — Costos del chatbot en microdólares (2026-10-18)

Un mensaje del chatbot cuesta una fracción de centavo y la regla 1 prohíbe `float`. Los costos se guardan como `bigint` en **microdólares** (1 USD = 1.000.000): `chat_messages.cost_usd_micros`, `chat_usage_monthly.cost_usd_micros` y `chat_settings.monthly_budget_usd_micros` (defecto 10.000.000). Sustituyen a `cost_usd` y `monthly_budget_usd` de §6.2.

## D-010 — Columnas de configuración por país (2026-10-18)

Para cumplir la regla 3 (nada configurable queda en el código) `country_settings` suma columnas que §6.2 no listaba: horario silencioso de cobros (inicio y fin, defecto 21:00–07:00, §13.1), confirmación automática en MasterShop (§14.5), modo A/B del pedido en MasterShop (§14.4), ocultar agotados (§6.4), costo de envío estimado (§21.2) y vencimiento de `pendiente_manual` (defecto 24 h, D-002).

## D-011 — RLS de cliente con permisos por columna (2026-10-18)

Las políticas de cliente autenticado son las literales de §6.1: lee sus direcciones, lista de deseos, pedidos e ítems, y lee y actualiza su propio perfil. Además se le revocan las columnas internas del pedido (costos, comisiones, notas internas, UTM, click IDs, alertas, clave de idempotencia) para que no las vea en su propio pedido. `anon` no tiene privilegios sobre esas tablas.

## D-012 — Seed sin datos del dueño (2026-10-18)

Los métodos de pago se cargan desactivados hasta tener credenciales. En Ecuador, el abono, el recaudo mínimo y `fx_rate_to_cop` quedan vacíos o en 0, marcados `[COMPLETAR]`. Colombia conserva los valores por defecto de §11.2 (abono $10.000, recaudo mínimo $20.000). Los marcadores `[COMPLETAR]` de los Anexos A y B se copian tal cual; no se inventan datos.

## D-013 — Repositorio (2026-10-18)

Repositorio privado en GitHub: `Proyectokolectivo1/WEB-IZAO`. Rama principal `main`.

## D-014 — Ubicación del proyecto (2026-10-18)

D: es exFAT: no admite symlinks y rompe `pnpm build` de la web y Git ("dubious ownership"). El proyecto se movió a `C:\Proyectos\WEB-IZAO` (NTFS), donde Git funciona sin `safe.directory`. La copia en `D:\WEB IZAO REACT` queda como respaldo hasta que el dueño la elimine. La clave `43iCH7rQJ3vx` no se copió.

## D-015 — Decisiones técnicas de `izao-infra` (2026-10-18)

- `.npmrc` con `node-linker=hoisted`, adoptado por la limitación de exFAT; funciona igual en Linux. Puede revisarse ahora que el repo está en NTFS.
- El worker compila con `tsc` y no con tsup.
- El worker escribe un latido en `/tmp/worker-alive` cada 15 s y el healthcheck de Docker lo lee.
- La CSP base de Nginx es provisional; se ajustará con los dominios de Wompi, Addi, Meta y píxeles (§26).
- `deploy.sh` actualiza `web` y luego `worker` con `up --wait` y vuelve al tag anterior si falla el healthcheck. Las réplicas de `web` se recrean en serie.

## D-016 — Cambios de contrato en la base (2026-10-18)

Respecto a §6.2, `izao-db` aplicó estos cambios:
- Tabla `number_sequences`: contador por país y tipo para `orders.number` (`IZ-CO-000001`) y `warranty_claims.number` (`GAR-CO-0001`), asignados por trigger. La app no genera el número.
- `brands.image_id`; `content_slots.country_code` nulo significa espacio global; los snapshots del pedido usan prefijos `contact_*` y `shipping_*`.
- `orders.payment_method` admite también `manual` (Ecuador por WhatsApp). Columnas nuevas: `orders.checkout_idempotency_key` (única) y `orders.alerts`.
- Checks de integridad en `orders`: `total_customer = subtotal − descuento + recargo` y, en contra entrega, `cod_collect_amount = total_customer − cod_deposit_amount`.
- `discount_codes.iza_can_offer`; `discount_codes.value` es el porcentaje entero (1–100) en `percent` y el monto en unidad menor en `fixed`.
- `shipments.total_provider`; `print_jobs.type` admite también `packing_list` y `test_page`.
- `warranty_settings.response_days` y `conditions_html`; `expense_categories.slug`; límites de §20.5 en `chat_settings`.
- `daily_sales_stats`: `prepaid_sent_value`, `delivered_count` y `cod_deposits_returned`.
- `catalog_listing`: columna `brand_slug`. Para paginar por keyset se ordena `sort_featured desc, product_id asc`.

## D-017 — Datos de prueba y nombres de ciudades (2026-10-18)

- Los 520 productos de prueba son ficticios, con marcas ficticias; ningún texto usa términos de originalidad, autenticidad, certificación o afiliación (regla 7). Se corrigieron 4 nombres que decían "Original Ficticio".
- Las ciudades y regiones se cargan tal cual las publican DANE e INEC, en MAYÚSCULAS. La presentación al cliente se decide en la tienda.
- Cundinamarca no tiene capital municipal en DIVIPOLA; su capital, Bogotá D.C., es una región propia.

## D-018 — Login del panel con MFA (2026-10-19)

Decisiones de `izao-admin` en T0.13:
- **Permisos:** la tabla módulo→roles y acción→roles vive en `apps/web/lib/auth/permissions.ts` (zona de `izao-admin`), no en `packages/core` (dueño `izao-pagos`). Si otro paquete la necesita, se mueve entonces. Está probada contra §24.3.
- **Sesión de 12 h (§26.1):** el plan gratuito de Supabase no limita la duración de la sesión. El panel guarda la cookie `izao_admin_inicio` (`httpOnly`), con el instante del ingreso firmado con HMAC-SHA256 y ligado al usuario. La firma usa `APP_ENCRYPTION_KEY` (§28) con una etiqueta de dominio propia; no se agrega una variable nueva. Rotar esa llave cierra todas las sesiones.
- **Aal2 siempre:** `/admin/**` exige MFA verificado a todos los roles; la columna `admin_users.mfa_required` queda sin efecto hasta que el módulo Usuarios defina su uso.
- **Bloqueo de intentos:** mientras Redis no esté disponible para el panel, el límite de 5 fallos por correo (15 por IP) y 5 fallos de código por usuario, en 15 minutos, se cuenta sobre `audit_log`. Cuando exista el rate limiting con Redis (§26.1) se puede sustituir.
- **QR del MFA:** lo genera Supabase (SVG en `data:`); no se agrega librería de QR. La CSP de `/admin` debe permitir `img-src data:`.
- **Auditoría de acceso:** `entity = 'sesion_admin'`, `actor` = id de Auth (o `anonimo` en fallos de contraseña). El correo se guarda solo como huella HMAC.
- **Rutas de operador:** `/admin/pedidos`, `/admin/garantias`, `/admin/agente-impresion`. Las rutas de `/admin` que no figuran en la tabla exigen rol `admin`.

## D-019 — Correcciones de infraestructura tras la revisión de la Oleada 0 (2026-10-19)

- **Redis:** `maxmemory` baja de 512 MB (§4.3) a **400 MB** con límite de contenedor de 600 MB, para dejar margen al fork del AOF y a la fragmentación. Política `noeviction` sin cambios.
- **Web:** heap `--max-old-space-size=1152` con límite de contenedor de 1536 MB (75 %). Con 2 réplicas el techo de memoria de todos los servicios es 5208 MB; si el inventario del VPS muestra poca memoria libre, se usa 1 réplica. El presupuesto está en `docs/RUNBOOK.md`.
- **Nginx:** `infra/nginx/izao.conf` contiene solo bloques `server` y se incluyen snippets `izao-*.conf` desde `/srv/izao/nginx/`. El contexto `http` va aparte por entorno (`env/container` y `env/host`). HSTS se emite en cada `location`; `includeSubDomains` queda comentado hasta confirmar que `web.izaoperfumeria.com` tiene HTTPS.
- **Migraciones en el despliegue:** `deploy.sh` ya no ejecuta `supabase db push`. Si el commit toca `packages/db/supabase/migrations`, se detiene y exige `--migraciones-verificadas` tras aplicarlas con el MCP de Supabase y compararlas con `list_migrations` (D-008).
- **Backups:** se cifran con `age` o `gpg` (obligatorio), con permisos 600/700, sin datos de `auth.refresh_tokens`, `auth.sessions`, `auth.flow_state` ni `auth.one_time_tokens`. `restore.sh --target-url` solo acepta `localhost`, bases `izao_restore_*` y `--confirmo-base-temporal`. Tras restaurar, todos los usuarios deben iniciar sesión de nuevo.
- **Cron:** en horas UTC (backup `0 8 * * *` = 03:00 Bogotá; keepalive `0 9 */3 * *`), sin depender de `CRON_TZ`.

## D-020 — Endurecimiento del acceso al panel tras la revisión (2026-10-19)

- **Bloqueo de intentos (M5):** falla cerrado. El intento (`login_intento`, `mfa_intento`) se registra en `audit_log` ANTES de autenticar y el conteo ya lo incluye; si no se puede registrar o contar, se niega el ingreso. Un ingreso correcto descuenta un intento. Límites: 5 por correo, 15 por IP y 5 códigos por usuario cada 15 minutos. No cubre las llamadas directas a Supabase Auth con la llave publicable: por eso el manual indica los límites y el CAPTCHA que el dueño configura en Supabase, y queda como tareas futuras el `limit_req` de Nginx y el límite con Redis.
- **`crear-admin` (M6):** si el correo ya existe pide confirmación explícita (SI o `--confirmar-existente`) y fija la contraseña con `auth.admin.updateUserById`. No cambia `role` ni `is_active` sin `--rol` o `--activar`; no usa `upsert`.
- **Cookie propia (M9):** el panel guarda su sesión en `sb-izao-admin` (servidor, middleware y navegador) para no compartir ni reescribir la cookie `sb-<ref>-auth-token` de la tienda. El cierre de sesión es de alcance local (`signOut({ scope: 'local' })`), para no revocar la sesión de la tienda del mismo correo.
- **Clave maestra (B5):** `APP_ENCRYPTION_KEY` se valida como base64 de exactamente 32 bytes y nunca se usa tal cual como llave HMAC: la marca de sesión y la huella de correos usan subllaves distintas derivadas con HKDF-SHA-256 (Web Crypto, corre en Node y Edge). Cambiar la clave invalida las sesiones abiertas.
- **Ventana de enrolamiento MFA (B8):** inscribir un TOTP exige `app_metadata.mfa_enrolamiento_hasta` vigente, que solo fija el servicio. `crear-admin` la abre por 24 horas al crear la cuenta o al confirmar un correo existente, y se cierra al terminar la inscripción. Así conocer solo la contraseña no permite registrar un autenticador propio.

## D-021 — El factor MFA aprobado por el servidor (2026-10-19)

- **Corrección a D-020:** la ventana `mfa_enrolamiento_hasta` solo la revisa la acción del panel. Con la contraseña y la llave publicable, alguien puede llamar directo a `/auth/v1/factors` de GoTrue, inscribir su propio TOTP y verificarlo, de modo que la ventana por sí sola NO impide que un atacante con la contraseña entre. Lo que D-020 decía de B8 queda como una primera barrera, no como garantía.
- **Decisión:** al confirmar la inscripción en el panel, el servidor guarda con el rol de servicio el `factor_id` en `app_metadata.mfa_factor_aprobado` (y cierra la ventana) y emite la cookie firmada `izao_admin_mfa` (HMAC con subllave HKDF, ligada al usuario y al factor, 12 h). Al verificar el código en cada ingreso solo se acepta el factor aprobado.
- **Comprobación en cada petición:** el middleware y `guard` rechazan una sesión aal2 que no traiga la cookie `izao_admin_mfa` válida para el factor aprobado de `app_metadata`. En ese caso el middleware cierra la sesión local, borra las cookies y audita `mfa_no_aprobado`. No se consulta la API de administración en cada petición: la cookie firmada solo la puede emitir el servidor, después de verificar el código con el factor aprobado. No requiere cambios de esquema.
- **Recuperación:** `crear-admin --reiniciar-mfa` (sobre un correo existente, con confirmación) borra los factores TOTP y la aprobación y reabre la ventana de 24 h.
- **Sin migración de datos:** aún no hay administradores en producción; quien tuviera un factor inscrito antes de este cambio debe reiniciarlo con ese indicador.

- **Complemento a D-021 (2026-10-19):** la ventana de enrolamiento de 24 h se abre solo al crear el usuario o con `crear-admin --reiniciar-mfa`; reemplazar la contraseña de un usuario existente ya no la reabre. Mientras la ventana está abierta, la primera inscripción depende de quién llegue primero: quien conozca la contraseña y complete la inscripción antes que el dueño (llamando a la pantalla del panel) queda como el autenticador aprobado. Por eso el dueño debe activar su verificación apenas se cree la cuenta, y `mfa_no_aprobado`/`mfa_inscrito` en la auditoría permiten detectar una inscripción ajena (se corrige con `--reiniciar-mfa`).

## D-022 — Decisiones de la Oleada 1 sobre estados, descuentos y documentos (2026-10-19)

- **Estados:** se agregan las transiciones `abandonado → requiere_reembolso` (abono tardío sin stock, §12.2) y `expirado → requiere_reembolso` (pago completo aprobado después de expirar), con alerta al admin. Cambian lo que dice §16, donde `expirado` era final.
- **Código fijo ≥ subtotal:** el dueño indica que no ocurre porque los precios de las lociones superan siempre los valores fijos. No hay manejo especial; el motor de precios solo marca un error estable si `total_customer <= 0` con un método en línea, para que el checkout se niegue a crear el pago.
- **Documentos:** `izao-pagos` interpretó reglas que §10.1 no define (cédula de Ecuador 10 dígitos, RUC 13, documentos numéricos de Colombia de 3 a 15 dígitos, CE y pasaporte de 3 a 20 alfanuméricos; códigos `CEDULA`, `RUC`, `PASAPORTE`). Quedan marcadas `[VERIFICAR]` con MasterShop y las pasarelas.
- **Interpretaciones del motor de precios:** `exclude_ids` excluye por producto o categoría; `min_subtotal` se compara con el subtotal de todo el carrito; un código vale desde `starts_at` inclusive hasta antes de `ends_at`; el correo es opcional en el checkout; límites técnicos de 999 unidades por línea y 100 líneas por carrito.
- **`usage_limit_per_customer` con cliente sin identificar:** la vista previa aplica el código con `customer_check_pending`; el checkout del servidor debe negarse a crear el pedido en ese estado.
- **`buildCarrierLines`** vive en `packages/integrations/mastershop` (izao-logistica) y usa `allocate` de `@izao/core`, no en `packages/core` como dice la skill `izao-motor-precios`.
- **Consentimientos y código en el pedido:** `orders.terms_accepted_at`, `data_policy_version`, `whatsapp_opt_in` y `discount_code_text` (esta última la rellena un trigger).
- **Coordinación de Git:** los agentes commitean con `git commit -o -- <rutas>` para no llevarse el stage ajeno.
