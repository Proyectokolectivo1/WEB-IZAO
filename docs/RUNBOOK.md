# Runbook de operación

Mantenido por `izao-infra`. El inventario del VPS (T0.15) se añadirá aquí cuando el MCP `contabo` esté disponible.

## Backups (§4.6)

Scripts en `infra/scripts/`: `backup.sh`, `restore.sh`, `keepalive.sh`, `check-alerts.sh`, `izao.cron`.

### Qué se respalda

- Base: `pg_dump` de los esquemas `public`, `auth` y `storage`, comprimido y **cifrado** → `/srv/izao/backups/db/AAAA-MM-DD.sql.gz.age` (o `.gpg`).
- De `auth.*` solo se respaldan los **datos** de `users`, `identities`, `mfa_factors` y `schema_migrations`; el resto (sesiones, refresh tokens, desafíos y claims MFA, flow_state, tokens de un solo uso, auditoría...) se excluye leyendo la lista de tablas de la base (cubre tablas nuevas de GoTrue). Un respaldo parcial de tablas con llaves foráneas entre sí no se podría restaurar. Tras restaurar los usuarios deben iniciar sesión de nuevo. `mfa_factors` y los hashes de contraseña sí van, por eso el cifrado es obligatorio. La prueba usa un esquema `auth` tipo GoTrue (`infra/scripts/fixtures/auth-gotrue-schema.sql`, representativo, no un volcado literal): restaurar contra el esquema real de Supabase sigue pendiente de verificar.
- Media: `tar` incremental (completo los domingos) en `/srv/izao/backups/media/`. Son imágenes públicas; no se cifran.
- Permisos: carpetas `700`, archivos `600` (`umask 077`). Retención 14 días.
- `backup.sh` se niega a respaldar la base si no hay `BACKUP_AGE_RECIPIENT` o `BACKUP_GPG_RECIPIENT`.

### Llaves de cifrado

La llave **pública** va en `infra/.env` del VPS; la **privada nunca se sube al VPS** (guárdala en un gestor de contraseñas y en una copia fuera de línea).

Con `age` (recomendado; `apt install age`), en el equipo del dueño:

```bash
age-keygen -o izao-backup.key        # imprime "Public key: age1..." → BACKUP_AGE_RECIPIENT
```

Con `gpg`: `gpg --quick-generate-key "izao-backup" default default never`, exportar la pública (`gpg --export -a`) e importarla en el VPS; `BACKUP_GPG_RECIPIENT` es el correo o la huella.

### Restaurar (siempre en una base temporal)

Se hace en un equipo que tenga la llave privada y Docker (nunca en el VPS ni sobre Supabase):

```bash
# 1) Traer el archivo cifrado del VPS a ese equipo
# 2) Contenedor temporal automático: restaura, imprime conteos por tabla y se borra
BACKUP_AGE_IDENTITY=/ruta/izao-backup.key infra/scripts/restore.sh 2026-10-19.sql.gz.age
#    con gpg: la llave privada debe estar en el llavero local
infra/scripts/restore.sh 2026-10-19.sql.gz.gpg --counts conteos.txt
# 3) Contra una base temporal local ya existente (lista blanca estricta)
infra/scripts/restore.sh archivo.sql.gz.age --confirmo-base-temporal \
  --target-url postgres://postgres:CLAVE@127.0.0.1:5432/izao_restore_prueba
```

`restore.sh --target-url` solo acepta `localhost`/`127.0.0.1`, bases `izao_restore_*`, exige `--confirmo-base-temporal` y rechaza cualquier destino igual a `DATABASE_URL`. Antes de cargar crea el esquema `extensions` y las extensiones (pgcrypto, pg_trgm, unaccent, citext, uuid-ossp) y los roles de Supabase.

Prueba automática del ciclo completo (migraciones y seed reales → backup cifrado → restauración → conteos): `bash infra/scripts/test-backup-restore.sh`.

### Programación (`izao.cron`)

Horas en UTC (sin depender de `CRON_TZ`; `.env` se carga con `run-with-env.sh`, que lo lee como texto literal; todo valor con `$`, `#` o espacios va entre comillas simples para que cron y Compose coincidan (el script avisa por stderr si no)): backup 03:00 Bogotá = `0 8 * * *`, keepalive de Supabase cada 3 días, alertas de base (70 % de 500 MB) y disco (80 %) cada 6 horas. Instalar en `/etc/cron.d/izao` (T0.16).

### Alertas

`alertar()` escribe `/srv/izao/backups/ALERTA.txt`, envía correo a `ADMIN_ALERT_EMAIL` si el host tiene `mail`, y avisa al monitor push de Uptime Kuma si `UPTIME_PUSH_URL` está definida.

### Prueba de restauración en producción (2026-11-09) — PENDIENTE de la llave del dueño

Estado verificado en el VPS (solo lectura): `db/2026-11-03..08.sql.gz.age` existen (450-550 KB, permisos 600, cabecera `age-encryption.org/v1`; el cron diario corre). La llave privada no está en el VPS (correcto) y el Docker local de la sesión del agente no arranca, así que **no se pudo restaurar el último backup real**. Lo único probado de extremo a extremo es el ciclo con migraciones y fixture (`test-backup-restore.sh`). Para cerrar la prueba, en el PC del dueño (con Docker y la llave `izao-backup.key`):

1. Traer el último archivo: `scp`/SFTP de `/srv/izao/backups/db/2026-11-08.sql.gz.age` (o el más reciente) a una carpeta local.
2. `BACKUP_AGE_IDENTITY=/ruta/izao-backup.key bash infra/scripts/restore.sh 2026-11-08.sql.gz.age --counts conteos.txt` (contenedor postgres:17 desechable; nunca toca Supabase).
3. Comparar `conteos.txt` con la base viva (`select count(*)` de products, orders, media, profiles...); deben coincidir salvo lo creado después del backup.
4. Anotar aquí fecha, archivo y resultado. Tras restaurar, los usuarios deben iniciar sesión de nuevo (sesiones excluidas).

Media: el árbol `/srv/izao/media` pasó a uid 100 / grupo www-data 2750 el 2026-11-06 y el usuario `izao` del host dejó de poder leerlo: **los backups de media del 06, 07 y 08 fallaron** (`*.tar.gz.tmp` de 45 bytes; los anteriores están vacíos porque aún no había imágenes). `backup.sh` ahora empaqueta vía `docker exec izao-worker-1 tar` (completo diario, probado a mano en el VPS: 364 KB con las imágenes actuales). Aplica tras el próximo `git pull` en el VPS; entonces `bash infra/scripts/backup.sh --media-only` y verificar con `tar -tzf`. Restaurar media: `tar -xzf AAAA-MM-DD-full.tar.gz -C <carpeta_vacía>` (nunca sobre `/srv/izao/media` en uso). Los `.tmp` fallidos se pueden borrar (están en `/srv/izao/backups/media`, requiere aprobación).

## Media huérfana (archivos sin fila en la base)

Solo lectura, no borra: `bash infra/scripts/media-huerfanos.sh` (ejecuta `media-huerfanos.mjs` dentro de `izao-worker-1`, que lee `media` y `media_file_deletions` por REST y recorre `/srv/izao/media`). Informa HUERFANOS, TEMPORALES (>1 h), y EN BASE SIN ARCHIVO (informativo). Excluye `warranty/`, `labels/`, `agent-screenshots/` (otros módulos). Procedimiento: 1) ejecutar y guardar la salida; 2) el dueño revisa la lista; 3) solo con su aprobación se borra lo aprobado (con `rm` dirigido por una lista revisada, tras un backup de media fresco). Ejecución 2026-11-09 (copia en `/srv/izao/tmp`): 13 archivos públicos en disco, 0 huérfanos, 0 temporales; 170 rutas de la base sin archivo (casi todas `product/prueba/*` del seed y algunas de pruebas de 2026/11).

## HSTS

`Strict-Transport-Security: max-age=15768000` (6 meses) solo en HTTPS, sin `includeSubDomains` ni `preload` (`infra/nginx/izao-zones.conf`, mapa `$izao_hsts`). Aplicado en el VPS 2026-11-09 (copia previa `/srv/izao/tmp/izao-zones.conf.bak-hsts-20261109`, `sudo nginx -t`, reload). Antes estaba en 1 año. Activar `includeSubDomains` solo cuando `web.izaoperfumeria.com` tenga HTTPS válido; `preload` solo con decisión explícita (es casi irreversible).

## Despliegue

`infra/scripts/deploy.sh [--dry-run]`. Si falla la actualización o el healthcheck, revierte a las imágenes `izao-web:<sha anterior>` e `izao-worker:<sha anterior>` con `up -d --no-build --no-deps --wait`. Si esas imágenes no existen avisa y no revierte. Prueba: `bash infra/scripts/test-deploy-rollback.sh`.

## Presupuesto de memoria (VPS de 8 GB compartido con otros proyectos)

Límites de contenedor (`infra/docker-compose.yml`), con 2 réplicas de `web` en producción:

| Servicio | Límite | Heap / tope interno | Notas |
|---|---|---|---|
| web (x2) | 1536 MB c/u | `--max-old-space-size=1152` | El resto es memoria nativa, buffers y `sharp`; heap = 75 % del límite |
| worker | 1024 MB | `--max-old-space-size=768` | 75 % del límite |
| redis | 600 MB | `maxmemory 400mb`, `noeviction`, AOF | Margen de 200 MB para fork de AOF/RDB (copy-on-write), buffers y fragmentación. §4.3 decía 512 MB: se bajó a 400 MB para que el límite no mate a Redis |
| uptime-kuma | 384 MB | — | |
| nginx (solo sin proxy del host) | 128 MB | — | |
| **Total (techo)** | **5208 MB** | | Peor caso; el consumo normal es mucho menor |

El techo deja unos 3 GB para el sistema y los otros proyectos del VPS. Verificación automática: `bash infra/scripts/test-memoria.sh` (heap <= 80 % del límite, `maxmemory` <= 75 % del límite de Redis, suma <= 5,5 GB). Si el inventario del VPS (T0.15) muestra menos memoria libre, reducir primero a 1 réplica de `web` (`WEB_REPLICAS=1`).

Redis lleva las colas (`noeviction`): si llega a `maxmemory` rechaza escrituras en vez de perder trabajos.

### Migraciones en el despliegue (D-008)

`deploy.sh` no ejecuta `supabase db push`: las migraciones se aplican con el MCP de Supabase y los archivos de `packages/db/supabase/migrations/` son la fuente de verdad. Si el commit nuevo toca esa carpeta, `deploy.sh` se detiene y exige `--migraciones-verificadas` tras comprobar a mano:

1. Aplicar las migraciones pendientes con `apply_migration` (en el proyecto `wyxjmlgrcjclelbrluvd`).
2. Ejecutar `list_migrations` y comparar: cada archivo `AAAAMMDDHHMMSS_nombre.sql` debe tener una versión remota con el mismo número y nombre, y no debe haber versiones remotas sin archivo.
3. Opcional: `get_advisors` (seguridad y rendimiento) tras el cambio.
4. Volver a ejecutar `deploy.sh --migraciones-verificadas`.

Ejemplo de comparación local: `ls packages/db/supabase/migrations | sed 's/\.sql$//'` frente a la lista de `list_migrations`.

### Rollback: de dónde sale el tag anterior

`deploy.sh` no toma el tag de git (tras un despliegue fallido HEAD podría quedar en el commit malo). Orden: `/srv/izao/ultimo-ok` (una línea `<tag> <commit-git>`, se escribe tras un healthcheck sano o un rollback exitoso), luego el tag de la imagen del contenedor `web` vivo y, solo como último recurso, git. Tras revertir, `git reset --keep` devuelve el repositorio al commit anterior. Lo mismo ocurre si falla algo en los pasos 1 a 4. La guarda de migraciones compara contra el **commit del último despliegue sano** guardado en `ultimo-ok`, así un despliegue fallido no oculta sus migraciones al siguiente intento.

## Nginx

- Versiones probadas con `bash infra/scripts/test-nginx.sh`: 1.27, 1.24 (Ubuntu 24.04) y 1.18 (Ubuntu 22.04). Por eso se usa `listen 443 ssl http2;` y no `http2 on;`.
- Rate limits: `/api/` 30 r/s, `/api/chat` 10 r/min, formularios 5 r/min, y `POST /admin/login` y `POST /admin/mfa/*` 5 r/min por IP (zonas separadas). Además, **todo POST con cabecera `Next-Action`** se limita a 1 r/s con ráfaga de 30 sin importar la ruta, porque Next 15 ejecuta Server Actions en cualquier ruta y el límite por ruta se esquivaría con un POST a `/`. Nginx no sabe qué acción se invoca: el bloqueo por intentos fallidos del login debe existir también en la aplicación.
- CSP: se elige por ruta con un `map` (`izao-zones.conf`). Hoy `/admin/**` y la tienda tienen el mismo contenido (ambas con `img-src data:`); se separan para poder quitar `data:` solo de la tienda cuando izao-tienda confirme que no usa placeholders borrosos (`blurDataURL`). El panel lo necesita para el QR del MFA.

## Base de datos: retención de la bitácora y publicación de páginas legales

- **Retención de `audit_log`.** La bitácora es de solo agregar (UPDATE, DELETE y TRUNCATE fallan). Los eventos de acceso
  (`entity = 'sesion_admin'`) se purgan con `select public.purgar_audit_log();` (solo `service_role`). Sin argumento usa
  `site_settings.audit_retention_days` (por defecto 180, mínimo 30, editable en el panel). Devuelve cuántos eventos borró.
  Los demás eventos no se borran nunca. Solo `postgres` y `service_role` tienen DELETE sobre la tabla (lo vigila la prueba `11_audit_retencion_config`).
- **Marcadores en páginas legales.** Una página no pasa a `published` si su HTML contiene un marcador: corchetes cuyo contenido
  empieza por una palabra de 2 o más letras MAYÚSCULAS (`[COMPLETAR]`, `[RAZÓN SOCIAL]`, `[ID]`, `[COMPLETAR: algo]`). El error nombra el
  marcador encontrado. No cuentan los corchetes con cifras o minúsculas (`[30]`, `[más detalles]`), `[CDATA[` ni las siglas `COP`, `USD`, `IVA` y `UVT`.
  Para permitir otra sigla hay que añadirla a la lista de `enforce_page_publish_markers()` con una migración.

- **Límite de canjes por cliente (`claves_cliente`).** Identifica al cliente por documento, celular y correo normalizados con **SHA-256 sin sal** (`doc:`, `tel:`, `mail:` + valor). Sin sal, quien obtenga la tabla `discount_redemptions` podría confirmar por fuerza bruta si un documento, celular o correo concreto canjeó un código; la tabla solo la lee `service_role`, por eso hoy se acepta. Más adelante se evaluará reemplazarlo por **HMAC con una clave del servidor** (en `.env`, nunca en la base); cambiar el algoritmo invalida las claves ya guardadas y exigirá recalcular `customer_keys`. No se cambia ahora.
- **Pago tardío con descuento.** `confirmar_canje` se llama cuando el cliente ya pagó: confirma sin revalidar vigencia ni cupo. Si con eso se supera `usage_limit_total` o el límite por cliente devuelve `{ok:true, advertencia:'limite_superado'}` y el worker debe alertar al administrador. La vigencia de un código termina cuando `now() >= ends_at`.

## CI del agente de impresión

Job `agente-impresion` en `.github/workflows/ci.yml` (runner `windows-2022`, Python 3.12, caché de pip). Corre `python -m pytest -q` en `apps/print-agent` con servidor y SumatraPDF falsos: no imprime y no usa el token real. En local: `cd apps\print-agent && .venv\Scripts\python -m pytest -q`.

## Tareas futuras

- **B-n1 (antes de F1):** medir cuántos 429 produce la zona `izao_next_action` (60 por minuto por IP; todo POST con `Next-Action`). En Colombia muchos usuarios móviles comparten IP (CGNAT) y podrían saturarla durante el checkout. Revisar el log de Nginx (`limit_req`) con tráfico real y subir `rate`/`burst` si hace falta.

## F0b: primer despliegue en el VPS (2026-11-02)

- **Inventario previo:** Ubuntu 24.04, 4 CPU, 7,9 GB RAM, 93 GB libres, Nginx 1.24 del host en 80/443, sin contenedores ni otros proxies. El sitio estático anterior (`sites-available/izaoperfumeria` -> `/var/www/izaoperfumeria/dist`) se reemplaza por decisión del dueño.
- **Contenedores:** `izao-redis-1`, `izao-web-1`, `izao-worker-1` (imágenes `izao-web:68cdd45`, `izao-worker:68cdd45`), healthy. `web` en `127.0.0.1:3000`. Una sola réplica: el upstream apunta también a 3001 (se marca caído por `max_fails`). Uptime Kuma no se arrancó.
- **Despliegue:** el VPS no tiene `pnpm`; `deploy.sh --skip-tests` ya no ejecuta `pnpm install` (las imágenes lo instalan en el build). En el primer despliegue se ejecutaron a mano los pasos 4 y 5 (`docker compose build`/`up --wait` con `IZAO_TAG`) y se escribieron `/srv/izao/deploys.log` y `/srv/izao/ultimo-ok`.
- **Snapshot:** la API de Contabo respondió 401; no hubo snapshot previo.
- **Nginx:** `/srv/izao/nginx/izao.conf` contiene también `include izao-zones.conf` y el `upstream izao_web` (entra por `sites-enabled`, contexto http; no hace falta enlazar nada en `conf.d`). Los includes (`izao-{zones,proxy,security-headers,locations}.conf`) se copian a `/srv/izao/nginx/` desde `infra/nginx/`: **recopiarlos cuando cambien en el repo**. Reutiliza el certificado Let's Encrypt existente (ECDSA, authenticator nginx). `izao.conf` carga antes que `izaoperfumeria` y Nginx ignora los `server_name` duplicados del sitio viejo (solo avisos en `nginx -t`); el enlace viejo sigue sin quitarse (requiere root).
- **Backups:** `backup.sh` aborta porque `BACKUP_AGE_RECIPIENT` no está en `infra/.env`. Además el host no tiene `pg_dump` ni `age`. `/etc/cron.d/izao` no se pudo instalar (root).

## Permisos de /srv/izao/media (sin 777)

Modelo: dueño uid 100 (usuario `izao` de web y worker, que escriben `banners/`, `labels/`, `agent-screenshots/`, `warranty/`), grupo `www-data` (Nginx del host solo lee), carpetas 2750 y archivos 640. `warranty/`, `labels/` y `agent-screenshots/` quedan 700 para uid 100 y Nginx no los sirve (404). Nginx solo entrega webp, avif, jpg, jpeg, png y mp4 desde `/media/`, con `nosniff` y `Content-Security-Policy: default-src 'none'; sandbox`.

El compose usa `IZAO_MEDIA_DIR` con valor por defecto `/srv/izao/media` (deploy.sh exporta el mismo valor, no chocan). En local defina `IZAO_MEDIA_DIR=./data/media` en `infra/.env`.

Comandos del dueño, como root por VNC (teclado en inglés), uno por línea:

    cd /srv/izao/app
    git pull --ff-only
    bash infra/scripts/permisos-media.sh
    cp infra/nginx/izao-zones.conf /srv/izao/nginx/izao-zones.conf
    cp infra/nginx/izao-locations.conf /srv/izao/nginx/izao-locations.conf
    nginx -t
    systemctl reload nginx
    docker exec izao-web-1 touch /srv/izao/media/banners/prueba.txt
    docker exec izao-worker-1 touch /srv/izao/media/labels/prueba.txt
    rm -f /srv/izao/media/banners/prueba.txt /srv/izao/media/labels/prueba.txt

Los dos `cp` son necesarios: Nginx lee las copias de `/srv/izao/nginx/`. El `git pull` debe traer el commit de este cambio antes de recargar Nginx. Si Nginx del host usa otro grupo que `www-data`, anteponga `NGINX_GRUPO=nombre` al comando del script. Después comprobar: `/media/banners/<archivo>.webp` responde 200 y `/media/labels/1.pdf` responde 404.
