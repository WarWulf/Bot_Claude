#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/vps_safe_update.sh [branch]
#
# Example:
#   ./scripts/vps_safe_update.sh main

BRANCH="${1:-main}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"
TS="$(date +%Y%m%d_%H%M%S)"

echo "[info] root: ${ROOT_DIR}"
echo "[info] target branch: ${BRANCH}"

mkdir -p "${BACKUP_DIR}"

echo "[step] backup current workspace..."
tar -czf "${BACKUP_DIR}/tradingbot_workspace_${TS}.tar.gz" -C "${ROOT_DIR}" .
if [[ -f "${ROOT_DIR}/.env" ]]; then
  cp "${ROOT_DIR}/.env" "${BACKUP_DIR}/env_${TS}.bak"
fi

cd "${ROOT_DIR}"

echo "[step] fetch + hard-sync to origin/${BRANCH}..."
git fetch origin
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"
git clean -fd

echo "[step] ensure env file exists..."
if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "[warn] .env was missing and created from .env.example. Please review secrets."
fi

echo "[step] docker compose restart..."
docker compose down --remove-orphans || true
docker compose up --build -d

echo "[step] service status..."
docker compose ps
echo "[done] safe update completed."
