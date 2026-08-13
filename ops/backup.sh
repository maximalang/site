#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_root="${AGENT_WORLD_BACKUP_DIR:-${workspace_root}/backups}"
env_file="${AGENT_WORLD_ENV_FILE:-${workspace_root}/.env}"

mkdir -p -- "${backup_root}"
chmod 700 -- "${backup_root}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$(mktemp "${backup_root}/.agent-world-${timestamp}.XXXXXX")"
suffix="${temporary##*.}"
destination="${backup_root}/agent-world-${timestamp}-${suffix}.dump"
trap 'rm -f -- "${temporary}"' EXIT

docker compose --project-directory "${workspace_root}" --env-file "${env_file}" \
  exec -T postgres pg_dump \
  --username=agent_world --dbname=agent_world --format=custom --no-owner --no-privileges \
  >"${temporary}"

test -s "${temporary}"
chmod 600 -- "${temporary}"
ln -- "${temporary}" "${destination}"
rm -- "${temporary}"
trap - EXIT
printf '%s\n' "${destination}"
