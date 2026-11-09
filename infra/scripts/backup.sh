#!/usr/bin/env bash
# Backup diario (§4.6): pg_dump comprimido + tar incremental de media, retención 14 días.
#   infra/scripts/backup.sh [--db-only|--media-only] [--no-s3]
# Variables: DATABASE_URL (obligatoria para la base), BACKUP_DIR (def. /srv/izao/backups),
#   MEDIA_ROOT (def. /srv/izao/media), RETENTION_DAYS (14), DUMP_SCHEMAS ("public auth storage"),
#   BACKUP_AGE_RECIPIENT (llave pública age) o BACKUP_GPG_RECIPIENT: OBLIGATORIA, los dumps se cifran.
#   BACKUP_S3_ENDPOINT/BUCKET/KEY/SECRET (opcionales; copia solo los domingos; el dump ya va cifrado).
set -euo pipefail
umask 077
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DO_DB=1; DO_MEDIA=1; DO_S3=1
for a in "$@"; do
  case "$a" in
    --db-only) DO_MEDIA=0 ;;
    --media-only) DO_DB=0 ;;
    --no-s3) DO_S3=0 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $a" >&2; exit 2 ;;
  esac
done

export TZ="${TZ:-America/Bogota}"
BACKUP_DIR="${BACKUP_DIR:-/srv/izao/backups}"
MEDIA_ROOT="${MEDIA_ROOT:-/srv/izao/media}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DUMP_SCHEMAS="${DUMP_SCHEMAS:-public auth storage}"
HOY="$(date +%F)"
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/media"
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR/db" "$BACKUP_DIR/media"
fallo() { alertar "Backup falló en la línea $1"; exit 1; }
trap 'fallo $LINENO' ERR

if [ "$DO_DB" -eq 1 ]; then
  : "${DATABASE_URL:?DATABASE_URL no está definida}"
  if ! cifrado_configurado; then
    alertar "Backup de base NO realizado: define BACKUP_AGE_RECIPIENT o BACKUP_GPG_RECIPIENT (llave pública)"
    exit 1
  fi
  export PGURL="$DATABASE_URL"
  DESTINO="$BACKUP_DIR/db/$HOY.sql.gz.$(extension_cifrado)"
  args=(--no-owner --no-privileges)
  for s in $DUMP_SCHEMAS; do args+=(--schema="$s"); done
  # De auth.* solo se respaldan los DATOS de users, identities, mfa_factors y schema_migrations.
  # El resto (sesiones, tokens, desafíos MFA, estado de flujos, auditoría...) no sirve tras una
  # restauración, es sensible y tiene llaves foráneas hacia tablas excluidas (un respaldo que
  # incluya solo una parte no se podría restaurar). La lista se lee de la base para cubrir tablas
  # que GoTrue agregue en el futuro.
  if [[ " $DUMP_SCHEMAS " == *" auth "* ]]; then
    EXCLUIR_AUTH="$(pg_run psql -X -At -c "select tablename from pg_tables where schemaname = 'auth' and tablename not in ('users','identities','mfa_factors','schema_migrations') order by 1")"
    for t in $EXCLUIR_AUTH; do args+=(--exclude-table-data="auth.$t"); done
  fi
  log "pg_dump (cifrado) -> $DESTINO"
  pg_run pg_dump "${args[@]}" | gzip -9 | cifrar > "$DESTINO.tmp"
  [ -s "$DESTINO.tmp" ] || { alertar "Backup de base vacío"; exit 1; }
  chmod 600 "$DESTINO.tmp"
  mv "$DESTINO.tmp" "$DESTINO"
  log "Base respaldada ($(du -h "$DESTINO" | cut -f1))"
fi

if [ "$DO_MEDIA" -eq 1 ]; then
  if [ -d "$MEDIA_ROOT" ] && [ -r "$MEDIA_ROOT" ] && [ -x "$MEDIA_ROOT" ]; then
    SNAR="$BACKUP_DIR/media/media.snar"
    # Nivel 0 (completo) los domingos o si no hay estado; el resto de días, incremental.
    if [ "$(date +%u)" = "7" ] || [ ! -f "$SNAR" ] || ! ls "$BACKUP_DIR"/media/*-full.tar.gz >/dev/null 2>&1; then
      rm -f "$SNAR"; TIPO=full
    else
      TIPO=inc
    fi
    DESTINO_M="$BACKUP_DIR/media/$HOY-$TIPO.tar.gz"
    log "tar $TIPO de media -> $DESTINO_M"
    tar --listed-incremental="$SNAR" -czf "$DESTINO_M.tmp" -C "$MEDIA_ROOT" .
    mv "$DESTINO_M.tmp" "$DESTINO_M"
  elif [ -d "$MEDIA_ROOT" ] && command -v docker >/dev/null 2>&1 && docker exec "${WORKER_CONTAINER:-izao-worker-1}" true >/dev/null 2>&1; then
    # Media con permisos 2750 (uid del contenedor, grupo www-data): el usuario del host no la lee.
    # Se empaqueta desde el worker, que sí tiene acceso; siempre completo (la media es pequeña; el
    # tar incremental necesita leer el árbol en el host). Incluye también las carpetas privadas (warranty, labels, agent-screenshots); el destino es 700/600 como el resto.
    DESTINO_M="$BACKUP_DIR/media/$HOY-full.tar.gz"
    log "tar full de media vía contenedor -> $DESTINO_M"
    rm -f "$BACKUP_DIR"/media/media.snar
    docker exec "${WORKER_CONTAINER:-izao-worker-1}" tar -czf - -C /srv/izao/media . > "$DESTINO_M.tmp"
    [ -s "$DESTINO_M.tmp" ] || { rm -f "$DESTINO_M.tmp"; alertar "Backup de media vacío"; exit 1; }
    gzip -t "$DESTINO_M.tmp"
    chmod 600 "$DESTINO_M.tmp"
    mv "$DESTINO_M.tmp" "$DESTINO_M"
  else
    alertar "MEDIA_ROOT ($MEDIA_ROOT) ilegible y sin contenedor worker: media NO respaldada"
    exit 1
  fi
fi

# Retención. Base: archivos con más de N días. Media: se conserva la cadena completa
# desde el último "full" anterior al corte (un incremental sin su full no sirve).
log "Aplicando retención de $RETENTION_DAYS días"
find "$BACKUP_DIR/db" -name '*.sql.gz*' -mtime +"$RETENTION_DAYS" -delete
CORTE="$(date -d "-$RETENTION_DAYS days" +%F)"
BASE_FULL=""
for f in "$BACKUP_DIR"/media/*-full.tar.gz; do
  [ -e "$f" ] || continue
  d="$(basename "$f" | cut -c1-10)"
  if [[ ! "$d" > "$CORTE" ]]; then BASE_FULL="$d"; fi
done
if [ -n "$BASE_FULL" ]; then
  for f in "$BACKUP_DIR"/media/*.tar.gz; do
    [ -e "$f" ] || continue
    d="$(basename "$f" | cut -c1-10)"
    if [[ "$d" < "$BASE_FULL" ]]; then rm -f "$f"; fi
  done
fi

# Copia semanal opcional a S3 de Contabo (domingo).
if [ "$DO_S3" -eq 1 ] && [ "$(date +%u)" = "7" ] && [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ENDPOINT:-}" ] \
   && [ -n "${BACKUP_S3_KEY:-}" ] && [ -n "${BACKUP_S3_SECRET:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    log "Copia semanal a S3"
    for sub in db media; do
      AWS_ACCESS_KEY_ID="$BACKUP_S3_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET" \
        aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 sync "$BACKUP_DIR/$sub" "s3://$BACKUP_S3_BUCKET/$sub" --only-show-errors
    done
  else
    alertar "Hay variables BACKUP_S3_* pero falta el comando aws; no se copió a S3"
  fi
fi
log "Backup terminado"
