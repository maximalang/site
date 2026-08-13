#!/usr/bin/env bash
set -euo pipefail

if [[ "${AGENT_WORLD_RESTORE_ACK:-}" != "replace-database" ]]; then
  printf '%s\n' 'AGENT_WORLD_RESTORE_ACK=replace-database is required' >&2
  exit 64
fi
if [[ "$#" -ne 1 ]]; then
  printf '%s\n' 'usage: ops/restore.sh <backup.dump>' >&2
  exit 64
fi

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_root="$(realpath "${AGENT_WORLD_BACKUP_DIR:-${workspace_root}/backups}")"
env_file="${AGENT_WORLD_ENV_FILE:-${workspace_root}/.env}"
backup_file="$(realpath "$1")"
case "${backup_file}" in
  "${backup_root}"/*) ;;
  *) printf '%s\n' 'backup must be inside AGENT_WORLD_BACKUP_DIR' >&2; exit 64 ;;
esac
test -f "${backup_file}"
test -s "${backup_file}"

compose=(docker compose --project-directory "${workspace_root}" --env-file "${env_file}")
"${compose[@]}" exec -T postgres pg_restore --list <"${backup_file}" >/dev/null
"${compose[@]}" stop web codex-worker
restore_status=0
"${compose[@]}" exec -T postgres pg_restore \
  --username=agent_world --dbname=agent_world --clean --if-exists \
  --no-owner --no-privileges --exit-on-error --single-transaction \
  <"${backup_file}" || restore_status=$?
"${compose[@]}" up -d --no-deps --wait --wait-timeout 90 web codex-worker
if [[ "${restore_status}" -ne 0 ]]; then
  exit "${restore_status}"
fi
printf '%s\n' 'restore completed; verify /api/health/ready before serving traffic'
