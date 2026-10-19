# Runbook de operación

Mantenido por `izao-infra`. El inventario del VPS (T0.15) se añadirá aquí cuando el MCP `contabo` esté disponible.

## Backups (§4.6)

Scripts en `infra/scripts/`: `backup.sh`, `restore.sh`, `keepalive.sh`, `check-alerts.sh`, `izao.cron`.

### Qué se respalda

- Base: `pg_dump` de los esquemas `public`, `auth` y `storage`, comprimido y **cifrado** → `/srv/izao/backups/db/AAAA-MM-DD.sql.gz.age` (o `.gpg`).
- No se respaldan los datos de `auth.refresh_tokens`, `auth.sessions`, `auth.flow_state` ni `auth.one_time_tokens` (no sirven tras restaurar y son sensibles). Tras una restauración los usuarios deben iniciar sesión de nuevo. `auth.mfa_factors` y los hashes de contraseña sí van, por eso el cifrado es obligatorio.
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

Horas en UTC (sin depender de `CRON_TZ`): backup 03:00 Bogotá = `0 8 * * *`, keepalive de Supabase cada 3 días, alertas de base (70 % de 500 MB) y disco (80 %) cada 6 horas. Instalar en `/etc/cron.d/izao` (T0.16).

### Alertas

`alertar()` escribe `/srv/izao/backups/ALERTA.txt`, envía correo a `ADMIN_ALERT_EMAIL` si el host tiene `mail`, y avisa al monitor push de Uptime Kuma si `UPTIME_PUSH_URL` está definida.

## Despliegue

`infra/scripts/deploy.sh [--dry-run]`. Si falla la actualización o el healthcheck, revierte a las imágenes `izao-web:<sha anterior>` e `izao-worker:<sha anterior>` con `up -d --no-build --no-deps --wait`. Si esas imágenes no existen avisa y no revierte. Prueba: `bash infra/scripts/test-deploy-rollback.sh`.
