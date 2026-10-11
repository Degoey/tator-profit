#!/usr/bin/env bash
# =============================================================================
# Pemulihan database staging TatorProfit dari berkas backup pg_dump (-Fc).
#
# PERINGATAN: ini DESTRUKTIF. Tabel yang ada akan ditimpa (--clean --if-exists).
# Uji dulu pada database terpisah, jangan pada data berharga. Butuh persetujuan.
#
# Pemakaian (di VPS, dari root repositori):
#   scripts/restore-db.sh backups/tatorprofit_staging_YYYYmmdd_HHMMSS.dump
#
# Verifikasi dulu isi backup (non-destruktif):
#   scripts/restore-db.sh --list backups/<berkas>.dump
# =============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.staging}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-tatorprofit-staging}"

if [[ $# -lt 1 ]]; then
  echo "Pemakaian: $0 [--list] <berkas.dump>" >&2
  exit 1
fi

LIST_ONLY=0
if [[ "$1" == "--list" ]]; then
  LIST_ONLY=1
  shift
fi

BACKUP_FILE="$1"
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Berkas backup '$BACKUP_FILE' tidak ditemukan." >&2
  exit 1
fi

compose() {
  docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

get_env() {
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"''
}

DB_USER="$(get_env POSTGRES_USER)"
DB_NAME="$(get_env POSTGRES_DB)"
if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "POSTGRES_USER/POSTGRES_DB tidak ada di $ENV_FILE." >&2
  exit 1
fi

if [[ "$LIST_ONLY" -eq 1 ]]; then
  echo "Isi backup '$BACKUP_FILE':"
  compose exec -T postgres pg_restore --list < "$BACKUP_FILE" | head -n 40
  exit 0
fi

echo "!! Pemulihan DESTRUKTIF ke database '${DB_NAME}' dari '${BACKUP_FILE}'."
read -r -p "Ketik 'RESTORE' untuk melanjutkan: " CONFIRM
if [[ "$CONFIRM" != "RESTORE" ]]; then
  echo "Dibatalkan."
  exit 1
fi

# Buat backup keselamatan sebelum menimpa.
echo "Backup keselamatan sebelum pemulihan..."
"$(dirname "$0")/backup-db.sh"

compose exec -T postgres pg_restore \
  --clean --if-exists --no-owner --no-privileges \
  -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE"

echo "Pemulihan selesai. Verifikasi dengan menjalankan aplikasi dan memeriksa log."
