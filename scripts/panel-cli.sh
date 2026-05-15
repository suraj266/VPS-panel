#!/usr/bin/env bash
#
# `panel` CLI helper — small wrapper around docker compose so day-2 ops
# don't need to remember the long compose invocation.
#
# Symlinked to /usr/local/bin/panel by install.sh.

set -euo pipefail

# Resolve the install directory by following our own symlink.
SELF="$(readlink -f "$0")"
INSTALL_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
cd "$INSTALL_DIR"

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)

usage() {
  cat <<EOF
panel — VPS Panel control CLI

Usage: panel <command>

Commands:
  up              Bring the full stack up (-d)
  down            Stop everything (keeps volumes)
  restart         Restart panel container only
  ps              List containers + status
  logs            Tail panel API logs (Ctrl+C to stop)
  logs-all        Tail logs from all services
  update          Pull latest code, rebuild image, restart panel
  rebuild         Rebuild panel image without pulling code
  shell           Get a shell inside the panel_app container
  exec            Run a command inside panel_app (e.g. panel exec ls /data)
  env             Show the current .env values (secrets redacted)
  health          Hit /api/health on the panel
  version         Show installed panel commit + image tag

Examples:
  panel update
  panel logs
  panel exec pnpm exec prisma studio
EOF
}

case "${1:-}" in
  up)        "${COMPOSE[@]}" up -d ;;
  down)      "${COMPOSE[@]}" down ;;
  restart)   "${COMPOSE[@]}" restart panel ;;
  ps)        "${COMPOSE[@]}" ps ;;
  logs)      docker logs -f panel_app ;;
  logs-all)  "${COMPOSE[@]}" logs -f ;;
  update)    exec "$INSTALL_DIR/scripts/update.sh" ;;
  rebuild)
    "${COMPOSE[@]}" build panel
    "${COMPOSE[@]}" up -d panel
    ;;
  shell)     docker exec -it panel_app sh ;;
  exec)
    shift
    docker exec -it panel_app "$@"
    ;;
  env)
    if [ ! -f .env ]; then echo "no .env"; exit 1; fi
    awk -F= '/^[A-Z_]+=/{
      key=$1
      if (key ~ /SECRET|PASSWORD|KEY|TOKEN/) { print key"=<redacted>"; next }
      print
    }' .env
    ;;
  health)
    if docker exec panel_app wget -qO- http://127.0.0.1:4000/api/health 2>/dev/null; then
      echo
      echo "✓ healthy"
    else
      echo "✗ panel_app not responding"
      exit 1
    fi
    ;;
  version)
    echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "Image:  $(docker inspect --format '{{.Image}}' panel_app 2>/dev/null || echo not-running)"
    ;;
  ""|-h|--help|help) usage ;;
  *)
    echo "unknown command: $1" >&2
    echo
    usage >&2
    exit 1
    ;;
esac
