#!/usr/bin/env bash
# Local deployment helper for this VM.
#
# Usage:
#   ./local-deploy.sh up        start redis + postgres
#   ./local-deploy.sh build     build the base image and the app image
#   ./local-deploy.sh run       (re)create the outline container from .env
#   ./local-deploy.sh deploy    build + run (use after code changes)
#   ./local-deploy.sh restart   recreate the container only (use after .env changes)
#   ./local-deploy.sh logs      follow the app logs
#   ./local-deploy.sh status    show containers and auth providers
set -euo pipefail
cd "$(dirname "$0")"

APP=outline-outline-1
BASE_IMAGE=outline-base-local
IMAGE=outline-outline:latest

up() {
  docker compose up -d redis postgres
}

build() {
  docker build -f Dockerfile.base -t "$BASE_IMAGE" .
  docker build --build-arg BASE_IMAGE="$BASE_IMAGE" -t "$IMAGE" .
}

run() {
  docker rm -f "$APP" >/dev/null 2>&1 || true
  docker run -d --name "$APP" \
    --network outline_default --restart unless-stopped \
    -p 3010:3010 \
    -v /var/lib/outline/data:/var/lib/outline/data \
    --env-file .env \
    -e DATABASE_URL="postgres://user:pass@postgres:5432/outline" \
    -e REDIS_URL="redis://redis:6379" \
    -e PGSSLMODE=disable \
    -e FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data \
    "$IMAGE"
}

case "${1:-}" in
  up) up ;;
  build) build ;;
  run | restart) up && run ;;
  deploy) up && build && run ;;
  logs) docker logs -f --tail 100 "$APP" ;;
  status)
    docker ps -a --filter name=outline --format '{{.Names}}\t{{.Status}}'
    curl -s -X POST http://localhost:3010/api/auth.config
    echo
    ;;
  *)
    sed -n 2,12p "$0"
    exit 1
    ;;
esac
