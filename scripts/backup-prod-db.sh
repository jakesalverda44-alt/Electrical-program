#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-prod-db.sh — nightly Postgres backup of the PRODUCTION database
# (Supabase). Same shape as backup-db.sh (dump, gzip, sanity-check, mirror to
# iCloud, 30-day prune, log to $REPO/.crm/backup.log) but for the live app's
# data instead of the local Docker copy.
#
# Runs pg_dump via the postgres:16-alpine Docker image so this Mac never needs
# a local pg_dump/psql install — Postgres 16 client tools stay in lockstep
# with whatever server version Supabase runs.
#
# Requires $REPO/.crm/prod-db.env defining PROD_DATABASE_URL (a Supabase
# connection string). That file is gitignored (.crm/) and must never be
# printed or logged by this script.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version"
DEST="/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Backups"
# Second copy goes to iCloud so a dead Mac doesn't take the backups with it.
DEST2="/Users/jakesalverda/Library/Mobile Documents/com~apple~CloudDocs/CRM-Backups"

# launchd runs jobs with a minimal PATH; make sure docker etc. are findable.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

LOG="$REPO/.crm/backup.log"
mkdir -p "$REPO/.crm"
mkdir -p "$DEST"

log() {
  # timestamp, status, file, size
  echo "$(date '+%Y-%m-%d %H:%M:%S') | $1 | ${2:-} | ${3:-}" >> "$LOG"
}

fail() {
  log "FAILURE (prod)" "" "$1"
  echo "backup-prod-db.sh: FAILURE: $1" >&2
  exit 1
}

# ── Load PROD_DATABASE_URL — never echo it, never log it ───────────────────
ENV_FILE="$REPO/.crm/prod-db.env"
if [ ! -f "$ENV_FILE" ]; then
  fail "$ENV_FILE not found. Create it with a single line: PROD_DATABASE_URL=<supabase-connection-string>, then chmod 600 it."
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
if [ -z "${PROD_DATABASE_URL:-}" ]; then
  fail "$ENV_FILE exists but does not define PROD_DATABASE_URL"
fi

# ── Ensure Docker daemon is up ──────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  open -a Docker
  waited=0
  until docker info >/dev/null 2>&1; do
    if [ "$waited" -ge 120 ]; then
      fail "docker daemon did not start within 120s"
    fi
    sleep 2
    waited=$((waited + 2))
  done
fi

# ── Dump (via the postgres:16-alpine image — no local pg client needed) ────
STAMP="$(date +%Y-%m-%d-%H%M)"
FINAL="$DEST/electrical_crm-prod-$STAMP.sql.gz"
TMP="$FINAL.tmp"

if ! docker run --rm postgres:16-alpine pg_dump "$PROD_DATABASE_URL" | gzip > "$TMP"; then
  rm -f "$TMP"
  fail "pg_dump/gzip failed"
fi

# ── Sanity checks ────────────────────────────────────────────────────────────
SIZE=$(stat -f%z "$TMP" 2>/dev/null || stat -c%s "$TMP" 2>/dev/null || echo 0)

if [ "$SIZE" -lt 1024 ]; then
  rm -f "$TMP"
  fail "dump file too small ($SIZE bytes) — refusing to keep"
fi

if ! gzip -t "$TMP" >/dev/null 2>&1; then
  rm -f "$TMP"
  fail "gzip integrity check failed"
fi

mv "$TMP" "$FINAL"

# Log success immediately — a later mirror/prune failure must never hide the
# fact that the dump itself already landed safely (same fix as backup-db.sh).
log "SUCCESS (prod)" "$FINAL" "${SIZE} bytes"
echo "backup-prod-db.sh: SUCCESS: $FINAL (${SIZE} bytes)"

# ── Mirror to iCloud (best-effort — local copy is already safe) ─────────────
mkdir -p "$DEST2" 2>/dev/null && cp "$FINAL" "$DEST2/" 2>/dev/null \
  || log "WARN" "$FINAL" "iCloud mirror failed"

# ── Retention: delete backups older than 30 days ────────────────────────────
find "$DEST" -name 'electrical_crm-prod-*.sql.gz' -mtime +30 -delete
find "$DEST2" -name 'electrical_crm-prod-*.sql.gz' -mtime +30 -delete 2>/dev/null || true
