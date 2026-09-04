#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-db.sh — nightly Postgres backup for the Electrical CRM.
# Dumps electrical_crm from the Docker `electrical-program-db-1` container,
# gzips it into the backup destination, prunes backups older than 30 days,
# and logs a status line to $REPO/.crm/backup.log
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version"
DEST="/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Backups"
# Second copy goes to iCloud so a dead Mac doesn't take the backups with it.
DEST2="/Users/jakesalverda/Library/Mobile Documents/com~apple~CloudDocs/CRM-Backups"
CONTAINER="electrical-program-db-1"

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
  log "FAILURE" "" "$1"
  echo "backup-db.sh: FAILURE: $1" >&2
  exit 1
}

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

# ── Ensure db container is running ──────────────────────────────────────────
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" != "true" ]; then
  (cd "$REPO" && docker compose up -d db) || fail "docker compose up -d db failed"
  waited=0
  until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do
    if [ "$waited" -ge 60 ]; then
      fail "db container did not become ready within 60s"
    fi
    sleep 2
    waited=$((waited + 2))
  done
fi

# ── Dump ─────────────────────────────────────────────────────────────────────
STAMP="$(date +%Y-%m-%d-%H%M)"
FINAL="$DEST/electrical_crm-$STAMP.sql.gz"
TMP="$FINAL.tmp"

if ! docker exec "$CONTAINER" pg_dump -U postgres electrical_crm | gzip > "$TMP"; then
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
# fact that the dump itself already landed safely. Previously the SUCCESS log
# line ran last, after the iCloud prune; that prune's non-zero exit (e.g. the
# iCloud folder briefly unavailable) tripped `set -e` and killed the script
# before SUCCESS was ever logged, even though the backup itself was fine.
log "SUCCESS" "$FINAL" "${SIZE} bytes"
echo "backup-db.sh: SUCCESS: $FINAL (${SIZE} bytes)"

# ── Mirror to iCloud (best-effort — local copy is already safe) ─────────────
mkdir -p "$DEST2" 2>/dev/null && cp "$FINAL" "$DEST2/" 2>/dev/null \
  || log "WARN" "$FINAL" "iCloud mirror failed"

# ── Retention: delete backups older than 30 days ────────────────────────────
# `electrical_crm-[0-9]*` (the stamp starts with a digit, e.g. -2026-09-01-1013)
# deliberately excludes `electrical_crm-prod-*.sql.gz` in the same $DEST — same
# 30-day window today, so harmless either way, but this prune must never touch
# the prod dumps even if the two retention policies diverge later (non-blocker
# T11, post-review).
find "$DEST" -name 'electrical_crm-[0-9]*.sql.gz' -mtime +30 -delete
# `|| true` — a transient iCloud-folder hiccup here must not exit the script
# non-zero after SUCCESS has already been logged above.
find "$DEST2" -name 'electrical_crm-[0-9]*.sql.gz' -mtime +30 -delete 2>/dev/null || true
