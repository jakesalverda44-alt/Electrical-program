# Running the Electrical CRM locally on a Mac

This gets a complete, self-contained copy of the CRM running on your MacBook —
its own database, its own data, no connection to the live Render deployment.
Nothing you do locally can affect production.

---

## First time: three steps

### 1. Install the three prerequisites

```bash
# Homebrew (skip if you already have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
brew install --cask docker
```

Then **open Docker Desktop once** from Applications and wait for the whale icon
in the menu bar to stop animating. Docker has to be running for the database to
start.

### 2. Get the code

```bash
git clone https://github.com/jakesalverda44-alt/Electrical-program.git
cd Electrical-program
```

### 3. Run setup

```bash
./setup-mac.sh
```

This checks your prerequisites, creates `backend/.env` with freshly generated
secrets, and installs dependencies (a few minutes on the first run). When it
finishes it prints **your local login email and password** — save them, they are
generated once and not stored anywhere else.

---

## Every day after that

```bash
./crm.sh              # start database + backend + frontend
```

Then open **http://localhost:3000** and log in with the credentials setup
printed.

```bash
./crm.sh down         # stop everything (your data is kept)
./crm.sh status       # what's running
./crm.sh restart      # stop, then start
./crm.sh logs backend # tail the backend log (Ctrl-C to exit)
./crm.sh seed         # load obviously-fake sample customers, bids, leads
```

Want a clean slate? `./crm.sh reset-db` wipes the local database and rebuilds it
from scratch with sample data. It asks for confirmation first, and it only ever
touches your local copy.

---

## What's actually running

| Piece | Where | What it is |
|---|---|---|
| Frontend | http://localhost:3000 | React + Vite dev server |
| Backend | http://localhost:3001 | Express API (`/api/health` to check) |
| Database | localhost:5432 | Postgres 16 in Docker |

The frontend proxies `/api` to the backend automatically, so there is no
frontend config to set up.

The database lives in a Docker volume, so it survives `./crm.sh down`, restarts,
and closing your laptop. Migrations apply automatically every time the backend
starts — you never run them by hand.

Your login is created once, from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in
`backend/.env`, and only while the users table is empty. Changing those values
later does nothing; to get a new login, use `./crm.sh reset-db`.

---

## Optional integrations

The AI proposal builder, Google Drive folders, Cloudinary uploads, and the Zapier
lead hooks are all **off** on a local copy. The app runs fine without them —
those features just report that they aren't configured.

To turn one on, uncomment the matching line at the bottom of `backend/.env` and
paste in a key, then `./crm.sh restart`. See `.env.example` for what each one is.

`backend/.env` is gitignored and never leaves your Mac. Don't commit it.

---

## Loading your real data (optional)

The local copy starts empty. If you want a snapshot of live data to work with:

1. In the Render dashboard, open the `accurate-power-db` database and copy its
   **External Database URL**.
2. Dump it, then load it locally:

```bash
pg_dump --no-owner --no-acl "<external-database-url>" > ~/crm-snapshot.sql
./crm.sh up
docker compose exec -T db psql -U postgres -d electrical_crm < ~/crm-snapshot.sql
```

`pg_dump` comes from `brew install libpq` if you don't have it.

Two things worth knowing. This is a **one-time copy**, not a sync — it won't
track later production changes, and local edits never flow back. And the dump
contains real customer data, so keep it on your Mac, off shared drives, and
delete `~/crm-snapshot.sql` when you're done with it.

---

## When something goes wrong

**`Cannot connect to the Docker daemon`** — Docker Desktop isn't running. Open
it from Applications and wait for the menu-bar whale to settle.

**`port is already allocated`, or the app loads stale code** — something is
already on 3000/3001/5432. `./crm.sh down` clears the app's own processes. To
find a stray one:

```bash
lsof -ti tcp:3000    # or 3001, or 5432
```

**Backend won't come up** — read the actual error:

```bash
./crm.sh logs backend
```

Most often it's Docker not running, or a `backend/.env` that got edited into an
invalid state. Deleting `backend/.env` and re-running `./setup-mac.sh` gives you
a fresh, valid one (it generates a new login password, and that new password
won't replace your existing one unless you also run `./crm.sh reset-db`).

**`npm install` fails on native modules** (`sharp`, `pdfjs`) — usually an old
Node. This project needs Node 20 or newer:

```bash
node -v
brew upgrade node
```

**Login rejected** — the password is the one `setup-mac.sh` printed, which is
also on the `SEED_ADMIN_PASSWORD` line of `backend/.env`:

```bash
grep SEED_ADMIN backend/.env
```

If the account was never created (the log says the users table was empty and no
credentials were set), `./crm.sh reset-db` rebuilds it from those values.
