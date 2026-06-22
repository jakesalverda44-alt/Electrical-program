#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# crm — local dev sandbox launcher for the Electrical CRM.
# Starts/stops Postgres (Docker) + backend (:3001) + frontend (:3000).
# Usage:  crm [up|down|restart|status|logs [backend|frontend]|seed]
#         crm           (no args) == crm up
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$REPO/.crm"          # pid + log files (gitignored)
mkdir -p "$RUN"

BACK_PID="$RUN/backend.pid"
FRONT_PID="$RUN/frontend.pid"
BACK_LOG="$RUN/backend.log"
FRONT_LOG="$RUN/frontend.log"
DB_CONTAINER="electrical-program-db-1"

port_busy() { lsof -ti tcp:"$1" >/dev/null 2>&1; }
alive()     { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

start_db() {
  echo "▸ Postgres (Docker)…"
  (cd "$REPO" && docker compose up -d db >/dev/null 2>&1)
  for _ in $(seq 1 30); do
    if docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
      echo "  ✓ database ready"; return 0
    fi
    sleep 1
  done
  echo "  ✗ database did not become ready"; return 1
}

start_backend() {
  if port_busy 3001; then echo "▸ Backend already running on :3001 — skipping"; return 0; fi
  echo "▸ Backend (:3001)…"
  (cd "$REPO/backend" && nohup npm run dev >"$BACK_LOG" 2>&1 & echo $! >"$BACK_PID")
  for _ in $(seq 1 40); do
    if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then echo "  ✓ backend healthy"; return 0; fi
    sleep 1
  done
  echo "  ✗ backend did not become healthy — see: crm logs backend"; return 1
}

start_frontend() {
  if port_busy 3000; then echo "▸ Frontend already running on :3000 — skipping"; return 0; fi
  echo "▸ Frontend (:3000)…"
  (cd "$REPO/frontend" && nohup npm run dev >"$FRONT_LOG" 2>&1 & echo $! >"$FRONT_PID")
  for _ in $(seq 1 30); do
    if curl -sf http://localhost:3000 >/dev/null 2>&1; then echo "  ✓ frontend up"; return 0; fi
    sleep 1
  done
  echo "  ✗ frontend did not come up — see: crm logs frontend"; return 1
}

stop_one() { # $1=pidfile $2=port $3=label
  local killed=0 pids
  if alive "$1"; then kill "$(cat "$1")" 2>/dev/null && killed=1; fi
  rm -f "$1"
  # Catch anything else holding the port (e.g. a server started outside the launcher).
  pids="$(lsof -ti tcp:"$2" 2>/dev/null || true)"
  if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; killed=1; fi
  [ "$killed" = 1 ] && echo "  ✓ stopped $3" || echo "  · $3 not running"
}

cmd_up() {
  start_db
  start_backend
  start_frontend
  echo
  cmd_status
}

cmd_down() {
  echo "▸ Stopping app…"
  stop_one "$FRONT_PID" 3000 frontend
  stop_one "$BACK_PID" 3001 backend
  echo "▸ Stopping Postgres (data is preserved in the Docker volume)…"
  (cd "$REPO" && docker compose stop db >/dev/null 2>&1) && echo "  ✓ database stopped"
  echo "Done. (Full wipe + re-seed: crm reset-db)"
}

cmd_reset_db() {
  if [ "${1:-}" != "-y" ] && [ "${1:-}" != "--force" ]; then
    printf "⚠  This DELETES the local CRM database (all data) and re-seeds it. Continue? [y/N] "
    read -r ans
    case "$ans" in y|Y|yes|YES) ;; *) echo "Aborted."; return 1 ;; esac
  fi
  echo "▸ Stopping app (frees database connections)…"
  stop_one "$FRONT_PID" 3000 frontend
  stop_one "$BACK_PID" 3001 backend
  echo "▸ Removing database container + volume…"
  (cd "$REPO" && docker compose down -v >/dev/null 2>&1) && echo "  ✓ volume removed"
  start_db
  start_backend   # re-applies all migrations and re-seeds the admin owner
  cmd_seed        # sample data
  start_frontend
  echo
  cmd_status
}

cmd_status() {
  local email; email="$(grep -E '^SEED_ADMIN_EMAIL=' "$REPO/backend/.env" 2>/dev/null | cut -d= -f2-)"
  echo "── CRM sandbox status ─────────────────────────────"
  docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 \
    && echo "  Postgres : up (container $DB_CONTAINER)" \
    || echo "  Postgres : DOWN"
  port_busy 3001 && echo "  Backend  : up   → http://localhost:3001/api/health" || echo "  Backend  : down"
  port_busy 3000 && echo "  Frontend : up   → http://localhost:3000"            || echo "  Frontend : down"
  echo "───────────────────────────────────────────────────"
  if port_busy 3000; then
    echo "  Open: http://localhost:3000"
    echo "  Login: ${email:-admin@local.test}  (password in backend/.env)"
  fi
}

cmd_logs() {
  case "${1:-backend}" in
    backend)  tail -n 60 -f "$BACK_LOG" ;;
    frontend) tail -n 60 -f "$FRONT_LOG" ;;
    *) echo "usage: crm logs [backend|frontend]"; exit 1 ;;
  esac
}

cmd_seed() {
  echo "▸ Seeding sample data…"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d electrical_crm \
    < "$REPO/database/seed_sample_data.sql"
}

case "${1:-up}" in
  up|start)   cmd_up ;;
  down|stop)  cmd_down ;;
  restart)    cmd_down; echo; cmd_up ;;
  status)     cmd_status ;;
  logs)       cmd_logs "${2:-backend}" ;;
  seed)       cmd_seed ;;
  reset-db)   cmd_reset_db "${2:-}" ;;
  *) echo "usage: crm [up|down|restart|status|logs [backend|frontend]|seed|reset-db [-y]]"; exit 1 ;;
esac
