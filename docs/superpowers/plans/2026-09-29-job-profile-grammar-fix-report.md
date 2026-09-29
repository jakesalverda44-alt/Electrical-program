# Job profile grammar fix (2026-09-29)

Bug: every live job-profile call returned Anthropic 400 "The compiled grammar is too large" (req_011CfYHS6Mm31JGgi4LEGWYb, plus the earlier Kissimmee call). `callJobProfileModel` sent `output_config.format = json_schema` with JOB_PROFILE_SCHEMA (14 required fields, nested objects, enums, systems).

Fix (backend/src/ai/jobProfile.ts):
- Request no longer sends `format`. `output_config: { effort: 'low' }` is kept for non-legacy models; legacy models send no output_config.
- JOB_PROFILE_SYSTEM now ends with a compact JSON shape (fields, enums inline, "ONLY one JSON object").
- `parseModelReply` (fenced or bare JSON, unchanged) now passes the parsed value through the new `normalizeModelReply`: every field present; missing or malformed becomes empty with confidence "none"; out-of-enum project_type (value emptied), building_sf.label, plan_date.kind become ""; systems missing or bad `present` become "unknown"; malformed other_brands dropped; non-object JSON is null. The existing validators in jobProfileValidators.ts still run on every surviving field in assembleJobProfile.
- JOB_PROFILE_SCHEMA is kept as documentation, not sent.

Tests (src/ai/jobProfile.test.ts, new block): no `format` in the request; fenced JSON parses via the client call; missing systems and bad enums normalize and still assemble; garbage and non-object JSON return null. No existing test asserted `format`.

Results: jobProfile-related 111/111 passed; full backend 2406 passed, 3 failed, all known flakes (intakeSimilarCache x2, integration lead-backfill). tsc clean.

Not verified against the live API (no real calls). Next live run should confirm Sonnet 5 returns the shape reliably.
