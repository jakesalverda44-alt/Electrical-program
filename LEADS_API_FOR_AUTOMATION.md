# Electrical CRM — Lead Creation API Reference

A guide for an external automation tool (e.g. Claude for Cowork, Zapier, a
custom script) to programmatically create leads in this app.

> All facts below are derived from the actual codebase, not assumptions.
> Key source files: `backend/src/routes/leads.ts`, `backend/src/routes/auth.ts`,
> `backend/src/middleware/auth.ts`, `backend/src/index.ts`,
> `database/migrations/049_create_leads.sql`, `render.yaml`.

---

## 1. Base URL / Deployment

- **Deployed on Render** as a single Node web service that serves both the API
  (under `/api/*`) and the built frontend.
- The public hostname the app assumes throughout its code is:

  ```
  https://electrical-program.onrender.com
  ```

- **API base URL:** `https://electrical-program.onrender.com/api`
- **Local dev:** `http://localhost:3001/api`
- **Health check (no auth):** `GET /api/health` → `{"ok":true}` — use this to
  confirm the service is live and reachable.

> ⚠️ The Render service is named `accurate-power-crm` in `render.yaml`, but the
> code consistently references `electrical-program.onrender.com`. Confirm the
> live host by hitting the health endpoint before relying on it.

---

## 2. Endpoint

**`POST /api/leads`**

Full URL: `https://electrical-program.onrender.com/api/leads`

(There is also `POST /api/leads/from-screenshot` for AI extraction from a
dealer-portal screenshot, but for normal programmatic creation use
`POST /api/leads`.)

---

## 3. Authentication

**JWT bearer token. There is NO standalone API-key mechanism.**

Every lead route requires the header:

```
Authorization: Bearer <JWT>
```

There is no pre-existing long-lived key to grab. You mint a token by logging in
as a real user:

- **`POST /api/auth/login`**
  Body: `{ "email": "...", "password": "..." }`
  Returns: `{ "token": "<JWT>", "user": { ... } }`
- Token lifetime: **12 hours**. There is no refresh endpoint — re-login when it
  expires.
- **Login is rate-limited: 10 attempts per 15 minutes per IP.** Cache the token
  and reuse it for the full 12 hours; do NOT log in on every request.

> Seed/default credentials exist (`jake@accuratepower.com` / `password123`,
> owner) but these are insecure defaults. Use a dedicated service account with a
> strong password in production.

---

## 4. Request Body Fields

| Field              | Type             | Required | Default     | Allowed values |
|--------------------|------------------|----------|-------------|----------------|
| `name`             | string           | **Yes**  | —           | any non-empty (trimmed) |
| `email`            | string           | No       | `null`      | any |
| `phone`            | string           | No       | `null`      | any |
| `address`          | string           | No       | `null`      | any |
| `source`           | string           | No       | `'phone'`   | `web`, `phone`, `referral`, `kohler`, `other` |
| `contact_method`   | string           | No       | `'phone'`   | `email`, `phone` |
| `interest_level`   | string           | No       | `'unknown'` | `unknown`, `warm`, `hot`, `not-interested` |
| `notes`            | string           | No       | `null`      | any |
| `follow_up_date`   | date `YYYY-MM-DD`| No       | `null`      | valid date |
| `salesperson_id`   | UUID             | No       | `null`      | must reference an existing `users.id` |
| `salesperson_name` | string           | No       | `null`      | any |

Notes:
- `stage` is **NOT** accepted on create — new leads always start at `'new'`.
  Change it later via `PATCH /api/leads/:id`.
- Enum values (`source`, `contact_method`, `interest_level`) and the
  `salesperson_id` foreign key are enforced by the **database**, not the app
  code. Invalid values pass the handler but are rejected by Postgres and surface
  as a generic `500 {"error":"Server error"}` (not a clean 400). Send exactly
  the allowed strings above.
- Any unrecognized fields are ignored.

---

## 5. Working curl Example

```bash
# 1) Get a token (cache it — valid 12h)
TOKEN=$(curl -s -X POST https://electrical-program.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jake@accuratepower.com","password":"password123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 2) Create a lead
curl -i -X POST https://electrical-program.onrender.com/api/leads \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Maria Gonzalez",
        "email": "maria.gonzalez@example.com",
        "phone": "+1-555-867-5309",
        "address": "742 Evergreen Terrace, Springfield, IL 62704",
        "source": "web",
        "contact_method": "email",
        "interest_level": "warm",
        "notes": "Requested quote for 22kW whole-home standby generator.",
        "follow_up_date": "2026-06-15"
      }'
```

---

## 6. Response

**Success: `201 Created`** — full new lead row as JSON. The new lead's UUID is in
the top-level `id` field.

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "created_at": "2026-06-08T17:30:00.000Z",
  "updated_at": "2026-06-08T17:30:00.000Z",
  "name": "Maria Gonzalez",
  "email": "maria.gonzalez@example.com",
  "phone": "+1-555-867-5309",
  "address": "742 Evergreen Terrace, Springfield, IL 62704",
  "source": "web",
  "contact_method": "email",
  "interest_level": "warm",
  "stage": "new",
  "notes": "Requested quote for 22kW whole-home standby generator.",
  "site_notes": null,
  "quoted_range": null,
  "follow_up_date": "2026-06-15",
  "linked_gen_id": null,
  "salesperson_id": null,
  "salesperson_name": null,
  "deleted_at": null
}
```

**Common errors:**

| Status | Body | Cause |
|--------|------|-------|
| `400`  | `{"error":"Name is required"}`        | Missing/blank `name` |
| `400`  | `{"error":"Invalid JSON request body"}` | Malformed JSON |
| `401`  | `{"error":"Unauthorized"}`            | Missing/malformed `Authorization` header |
| `401`  | `{"error":"Invalid token"}`           | Expired or invalid JWT |
| `500`  | `{"error":"Server error"}`            | DB rejection — invalid enum value, bad `salesperson_id` FK, etc. |

---

## 7. Rules, Validation & Gotchas

- **Validation:** Only `name` is validated in app code. Everything else is
  validated (if at all) by Postgres constraints — invalid enums/FKs come back as
  opaque `500`s, so validate your payload client-side first.
- **Duplicate detection: NONE.** There is no uniqueness constraint on `email`
  (or anything else) and no dedupe logic. Posting the same email/phone repeatedly
  creates multiple distinct leads. Handle idempotency on your side.
- **Rate limits:** No rate limiter on `/api/leads` — create calls are
  unthrottled. Only the auth endpoints are throttled (10 logins / 15 min / IP),
  so reuse the 12h token.
- **Webhook side effect:** On create, the app queues a Zapier "new lead"
  webhook keyed by `new:<contact_method>` (i.e. `new:email` or `new:phone`), if
  the corresponding `ZAPIER_WEBHOOK_*` env vars are configured on the server.
  This never blocks or fails your request, but be aware each created lead may
  trigger a downstream Zap. Delivery is durable (`webhook_outbox` table) with
  retries on failure, and **at-least-once** — a crash mid-delivery can
  re-deliver, so downstream Zaps should treat `lead_id` + `stage` as an
  idempotency key.
- **Salesperson fields:** `salesperson_id` / `salesperson_name` are NOT
  auto-filled from your token on this endpoint — they default to `null` unless
  you pass them. (The screenshot endpoint behaves differently.)
- **Stage on create is always `new`** — use `PATCH /api/leads/:id` to advance it.

---

## Quick Integration Checklist

1. `GET /api/health` → confirm `{"ok":true}`.
2. `POST /api/auth/login` once → store `token` (reuse for ≤12h).
3. `POST /api/leads` with `Authorization: Bearer <token>` and a body containing
   at least `name`.
4. Read the `id` from the `201` response to track / link the created lead.
5. Re-login when you get a `401 Invalid token`.
