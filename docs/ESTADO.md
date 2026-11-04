# Estado del proyecto (índice vivo)

Lo mantiene el líder. Leer esto y `CLAUDE.md` antes que cualquier otra cosa; la especificación solo por secciones (Grep u `offset`). Última actualización: 2026-10-20, a mitad de la Oleada 2/3.

## Dónde está todo
- Repo: `C:\Proyectos\WEB-IZAO` (NTFS), rama `main`, GitHub `Proyectokolectivo1/WEB-IZAO` (remoto sin conectar, sin `push`). Git funciona sin `safe.directory`.
- Supabase `wyxjmlgrcjclelbrluvd` (eu-central-1). Migraciones por el MCP de Supabase; archivos en `packages/db/supabase/migrations/` con la versión remota.
- VPS Contabo (Hub Europe, `169.58.102.153`): solo por el MCP `contabo`, con `tools/contabo-mcp/.env` ya configurado (ver Avance 2026-11-01). F0b sin hacer.
- Decisiones: `docs/DECISIONES.md` (D-001 a D-023). Procedimientos: `docs/RUNBOOK.md`, `docs/MANUAL_ADMIN.md`. Cierres: `docs/fases/oleada-0.md`, `oleada-1.md`.

## Hecho (una línea por área)
| Área | Estado | Dónde |
|---|---|---|
| Monorepo, Docker local, Nginx, deploy, backups cifrados | Hecho y revisado | `infra/`, `apps/web`, `apps/worker` |
| Esquema (65 tablas, RLS), seed, 520 productos de prueba, geografía CO/EC | Hecho; pgTAP 15 suites | `packages/db/` |
| Funciones de stock, canje y expiración | Hecho; concurrencia probada en local | `packages/db/supabase/migrations/` |
| Login admin con MFA, roles, bloqueo de intentos | Hecho; sin prueba real (faltan llaves) | `apps/web/lib/auth`, `apps/web/app/admin` |
| `@izao/core`: money, pricing (10 casos), order-state, schemas, contracts | Hecho | `packages/core/src/*` (import por subruta, p. ej. `@izao/core/pricing`) |
| MasterShop sin red: líneas, pedido, estados, mock, cliente | Hecho; sin API real | `packages/integrations/mastershop/` |
| Tienda: home, listado infinito, filtros, ficha, carrito, checkout, pedido | Hecho; sin probar con llaves reales | `apps/web/app/[country]`, `components/store`, `lib/store` |
| Checkout servidor (preview, pedido idempotente por huella, política de datos), `crear_pedido_checkout`, `aplicar_transicion_pedido` | Hecho; probado en memoria y pgTAP | `apps/web/lib/checkout`, `packages/db` |
| Wompi (link, webhook firmado, job) | Hecho con mock; firma sin confirmar con evento real | `packages/integrations/wompi`, `apps/worker/src/jobs/payments` |
| Panel: productos, importación/exportación, páginas legales | Hecho; sin probar en navegador | `apps/web/app/admin`, `lib/admin` |

## Contratos que no se deben romper
- Dinero: `bigint` en unidad menor; todo cálculo por `@izao/core/money` y `@izao/core/pricing`.
- Estados del pedido solo por `@izao/core/order-state` (`transicionar`).
- Funciones de la base devuelven jsonb `{ok, estado, repetido?, motivo?, advertencia?}`; solo `service_role`.
- `orders.number` y `discount_code_text` los asigna la base.
- Un checkout del servidor usa `checkoutInputSchemaFor(metodosActivos)` y recalcula con `calcularPrecios`.

## Pendiente
**Del dueño:** `tools/contabo-mcp/.env` y `setup-vps.sh`; llaves `age`; `apps/web/.env.local` y `crear-admin`; límites de Auth y CAPTCHA en Supabase; fotos, logo, catálogo real con IDs de MasterShop; datos legales ([COMPLETAR]); mover o borrar la clave `43iCH7rQJ3vx` de `D:\WEB IZAO REACT`; conectar `origin` y autorizar el primer `push`; credenciales de Wompi, WhatsApp, MasterShop, Addi, Sistecrédito, OpenRouter.
**Técnico:** `POST /api/checkout/preview` (vista previa del carrito, izao-pagos, Oleada 3: `CODE_INVALID` único, `max_quantity = min(existencias, pedida)`, `line_discount` por línea, rate limit Redis y Turnstile); F0b (HTTPS y backup real en el VPS); rate limiting con Redis; devolver stock al cancelar o devolver; panel debe impedir `payment_method_settings` activo con `cod_enabled` falso; suites pgTAP 01–12 sin repetir tras las últimas migraciones.

## Avance 2026-10-25 (panel completo y revisión)
Hecho: todos los módulos de §24.1 del panel (descuentos, influencers, métricas con RPC `metricas_*` y `daily_sales_stats`, garantías, gastos, usuarios, apariencia, clientes, sistema, home, reseñas, leads, chatbot); Addi (webhook, job, checkout; D-031, D-034, D-036); Sistecrédito en modo seguro (D-032, no vendible); job `metrics.recompute_day` + nocturno, cableado en pagos, carrier, billetera, web y panel; RPC atómicas `anonimizar_cliente`, `cancelar_pedido` (devuelve stock, D-035) y `admin_publicar_pagina`; `?ref`, UTM y atribución en el checkout; garantías y reseñas públicas; job `media.borrar_archivos`; Nginx bloquea `/media/warranty/` (falta desplegar al VPS).
Revisión (izao-revisor) con cambios requeridos: corregidos los hallazgos 1–10 salvo los de abajo.
Decisiones del dueño abiertas: reserva de Addi (60 min) vs aprobación tardía (`requiere_reembolso`); `cancelado → requiere_reembolso` (D-037, recomendado no tocar); comprobantes de gastos públicos por uuid o privados; proveedor de correo (garantías, respaldo de cobro, alertas).
Pendiente técnico: e2e/Lighthouse (izao-qa, hay que quitar `fixme`), widget Iza, Meta Ads y "Sincronizar ahora", "Probar conexión" OpenRouter, cierre de oleada con revisor, F0b del VPS. Regla vigente: un agente a la vez (CLAUDE.md, "Ahorro de tokens").

## Avance 2026-10-31
Hecho: chat de Iza (API SSE, widget, presupuesto micro-USD con `chat_registrar_uso`, filtro de regla 7, purga a 180 días en lotes de 100); Integraciones OpenRouter, Meta Ads, Meta Pixel, GA4 y TikTok (con [VERIFICAR] de Graph y tokens de eventos); sitemap/robots; e2e + axe + Lighthouse (docs/fases/F1.md); correcciones de las dos revisiones. Abierto: error de hidratación #418 intermitente (~0,3–3 %, sin causa; posible carrera Next 15.5/React 19), LCP ~2,7 s en el equipo de QA, `messages_count` no atómico (pedir RPC a izao-db), `CHAT_RETENCION_DIAS` sin documentar en `infra/.env.example`. Sin medir sin llaves: p95 del catálogo, k6, checkout real, Iza con OpenRouter real.
Bloqueado por el dueño: acceso SSH/VNC al VPS y despliegue (F0b), llaves reales, proveedor de correo, documentación de Sistecrédito.

## Avance 2026-11-01 (acceso al VPS)
Hecho: `tools/contabo-mcp/.env` listo y `npm run check` da SSH OK (usuario `izao`, grupo docker; Docker 29 y Compose v5 ya instalados; `setup-vps.sh` ya corrió). `.mcp.json` registra el MCP `contabo` del proyecto (c273e5f) y ya no tiene credenciales. Supabase `wyxjmlgrcjclelbrluvd` tiene aplicadas las 37 migraciones del repo (nada pendiente). `infra/.env` real ya está en el VPS (`/srv/izao/app/infra/.env`, 600).
Pendiente del dueño: (1) cerrar root temporal en la consola VNC: `rm /etc/ssh/sshd_config.d/00-temporal.conf && systemctl restart ssh`; (2) API de Contabo da 401 (solo afecta snapshots): regenerar Client Secret y API Password y actualizar `.env` del MCP; (3) crear repo vacío privado en GitHub y pasar la URL (el código aún no está en el VPS; `/srv/izao/app` solo tiene `infra/.env`); (4) confirmar DNS de `izaoperfumeria.com` (A para `@` y `www` → 169.58.102.153); (5) rotar secretos que pasaron por el chat y el historial local (Contabo, Supabase secret key, APP_ENCRYPTION_KEY: si se rota, cambiarla en ambos `.env`); (6) borrar `apps/web/.env - copia.example` y `apps/web/Nuevo Documento de texto.txt` (sin commit; pueden tener claves).
Siguiente paso exacto (líder, chat nuevo con MCP `contabo` cargado): `vps_policy` y `vps_inventory`; llevar el código a `/srv/izao/app` (git clone si ya hay repo, si no, otra vía acordada); `vps_exec` con `snapshot_first: true` solo si la API de Contabo funciona; primer despliegue con `izao-despliegue`; Nginx con el bloque `/media/warranty/`; certificados (F0b); backups con `BACKUP_AGE_RECIPIENT`; luego `crear-admin`. Guía para el dueño: `docs/PENDIENTES_DUENO.md`.

## Avance 2026-11-03 (VPS desplegado, pgTAP completo)
Hecho: VPS con web/worker/redis `healthy` (imagen 68cdd45), Nginx + certificado Let's Encrypt válido hasta 2027-01-16, HTTPS y `/api/health` OK. pgTAP 01–33 verdes en remoto (477/477 de 13–33; D-041 `next_cursor`). Prueba de concurrencia del checkout verde (`packages/db/tests/concurrencia/`, commits ab23cd3, 2d1fc0a). Esto reemplaza lo de "F0b sin hacer" y "código aún no está en el VPS" más arriba.
Pendiente del dueño (en orden): (1) en la consola VNC de Contabo como root: `apt install -y age` y agregar `BACKUP_AGE_RECIPIENT=age13aw49fmptsk0h0rdt9jr5gxgzwrpre6v86u5t98fac3xacykyudqwq2gv7` a `/srv/izao/app/infra/.env` (la política del MCP no deja a Claude hacerlo); guardar `C:\Users\Usuario\izao-backup.key` fuera del servidor; (2) `pnpm crear-admin` (necesita `apps/web/.env.local`); (3) publicar la política de tratamiento de datos de CO y EC desde el panel (sin ella el checkout rechaza todo); (4) regenerar Client Secret y API Password de Contabo (401) y actualizar `tools/contabo-mcp/.env`; (5) cerrar root temporal por VNC; (6) rotar secretos y borrar los dos archivos sin commit de `apps/web`; (7) credenciales sandbox de Addi, Wompi, WhatsApp, MasterShop y token del agente de impresión.
Actualización 2026-11-03 (noche): `age` instalado en el VPS, `BACKUP_AGE_RECIPIENT` y `DATABASE_URL` (Session pooler, puerto 5432) ya están en `infra/.env` del VPS (subido por `scp -i ~/.ssh/izao_claude_code`); backup real cifrado OK (`/srv/izao/backups/db/2026-11-03.sql.gz.age`). fail2ban instalado y root-por-contraseña cerrado. Pendiente: cron (el dueño, por VNC como root: `cp /srv/izao/app/infra/scripts/izao.cron /etc/cron.d/izao`; el MCP no puede escribir en /etc), uptime Kuma, y para izao-infra: `test-backup-restore.sh` falla en el VPS (usa ruta relativa tras `cd` en la línea 29 y `backup.sh` sin bit ejecutable; funciona con ruta absoluta pero `./backup.sh` da Permission denied: `git update-index --chmod=+x infra/scripts/*.sh`).
Siguiente paso exacto (líder): tras el cron, `vps_exec`: `crontab`/`ls /etc/cron.d/izao`, luego `crear-admin`, política de datos y credenciales sandbox. Luego, según credenciales: izao-pagos (sandbox Addi/Wompi), izao-logistica (MasterShop), izao-qa (e2e/Lighthouse), izao-agente-windows (instalar en PC de despacho).

## Oleada en curso
Oleada 2 (F1 catálogo; F2 contenido va después). Contratos de la tienda para el panel de contenido: claves `content_slots` `medios_de_pago`, `asesoria` y `busquedas_populares`; los beneficios y la asesoría del home salen de `home_sections.config` (`items[{icon,title,text}]` y `title/body/cta_label/cta_url`). Páginas legales: la tienda lee solo `pages.status = 'published'`. Reemplaza al texto siguiente cuando se cierre.
En curso: abono de contra entrega + WhatsApp (izao-pagos). Siguiente: izao-logistica (MasterShop), Addi/Sistecrédito, reseñas (POST /api/reviews), widget Iza, métricas. Espacios `nota_envio`/`valor_envio` ya sembrados.

## Reglas de continuidad y contexto
1. **Lectura mínima:** `CLAUDE.md`, este archivo, tu definición en `.claude/agents/`, tu skill y SOLO las secciones de la especificación de tu tarea.
2. **Contexto por debajo de ~30 %:** no leas archivos enteros sin necesidad (usa `Grep`, `offset`/`limit`), no vuelques salidas largas (`| tail -20`, `--filter`), no repitas lo que ya está en este archivo, reportes de máximo 25 líneas (archivos, hashes, resultado, dudas).
3. **Tu bitácora:** cada agente mantiene `docs/estado/<tu-agente>.md` (es tuyo; aunque `docs/` sea del líder). Máximo 40 líneas: `Hecho` (con hashes), `Pendiente`, `Siguiente paso exacto`, `Decisiones que necesitan al líder`. Actualízala antes de cada reporte final.
4. **Si estimas que tu contexto pasa de ~30 %:** llega a un punto seguro (pruebas verdes, commit), actualiza tu bitácora y termina con "Punto de retoma: …" en el reporte. No sigas trabajando.
5. **El líder:** al pasar de ~30 % actualiza este archivo, hace commit y propone abrir un chat nuevo con el prompt de retoma de abajo. Nunca cierra una oleada sin actualizar este archivo.
6. **Commits:** `git add -- <rutas> && git commit -o -m "..." -- <rutas>`, con `&&` y `set -o pipefail` si hay tuberías. Nunca `git add -A`.

## Prompt de retoma (pegar en un chat nuevo del líder)
```text
Eres el LÍDER técnico de Izao Perfumería. Lee solo CLAUDE.md, docs/ESTADO.md, docs/EQUIPO.md y el último docs/fases/oleada-N.md; no leas la especificación completa. Revisa docs/estado/*.md para ver el punto de retoma de cada agente y `git log --oneline | head -20`. Resume en 10 líneas dónde estamos y qué sigue; espera mi aprobación antes de crear el equipo de la oleada. Mismas reglas: tú coordinas, no implementas; máximo 4 compañeros; revisión de izao-revisor antes de cerrar; el VPS solo por el MCP contabo.
```
