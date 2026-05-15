#!/usr/bin/env bash
#
# Pull the latest panel code, rebuild, and restart the panel container.
# Other services (postgres, redis, nginx, panel_host) are NOT touched.
#
# Usage:
#   ./scripts/update.sh
# or via the panel CLI helper:
#   panel update

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "✗ .env not found in $ROOT_DIR — was the panel installed here?" >&2
  exit 1
fi

echo "▸ 1/4 Pulling latest code"
git pull --ff-only

echo "▸ 2/4 Rebuilding panel image (~30-90s if cached, longer on schema/deps changes)"
docker compose -f docker-compose.prod.yml --env-file .env build panel

echo "▸ 3/4 Restarting panel container"
docker compose -f docker-compose.prod.yml --env-file .env up -d panel

echo "▸ 4/4 Waiting for healthy"
sleep 3
for i in $(seq 1 30); do
  if docker exec panel_app wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    echo "✓ Panel is back online"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "⚠ Panel didn't respond in 30s. Tail logs: docker logs -f panel_app"
    exit 1
  fi
  sleep 1
done

echo
echo "Recent logs:"
docker logs --tail 20 panel_app
