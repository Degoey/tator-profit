#!/usr/bin/env bash
# =============================================================================
# Backup database staging TatorProfit (pg_dump format custom, terkompresi).
#
# Jalankan ini SEBELUM setiap migrasi. Tidak mengubah data apa pun — hanya membaca.
#
# Pemakaian (di VPS, dari root repositori):
#   scripts/backup-db.sh
#
# Lingkungan:
#   ENV_FILE   berkas env (default .env.staging)
#   COMPOSE_FILE, COMPOSE_PROJECT  menyesuaikan compose (default di bawah)
#   BACKUP_DIR direktori tujuan (default ./backups)
#   RETENTION  jumlah backup yang disimpan (default 14)
# =============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.staging}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-tatorprofit-staging}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${RETENTION:-14}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Berkas env '$ENV_FILE' tidak ditemukan. Set ENV_FILE bila berbeda." >&2
  exit 1
fi

compose() {
  docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# Ambil kredensial dari berkas env tanpa menampilkannya di log.
get_env() {
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"''
}

DB_USER="$(get_env POSTGRES_USER)"
DB_NAME="$(get_env POSTGRES_DB)"
if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "POSTGRES_USER/POSTGRES_DB tidak ada di $ENV_FILE." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.dump"

echo "Backup database '${DB_NAME}' -> ${OUT}"
# -Fc = format custom (terkompresi, bisa dipulihkan selektif).
compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT"

if [[ ! -s "$OUT" ]]; then
  echo "Backup gagal: berkas kosong." >&2
  rm -f "$OUT"
  exit 1
fi

echo "Selesai: $(du -h "$OUT" | cut -f1)"

# Retensi: simpan RETENTION berkas terbaru, hapus sisanya.
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n "+$((RETENTION + 1))" | while read -r old; do
  echo "Menghapus backup lama: $old"
  rm -f "$old"
done
