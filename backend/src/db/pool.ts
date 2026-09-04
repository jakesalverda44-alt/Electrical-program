import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Task 10 (audit data #20) — no explicit sizing or statement timeout before
// this: pg defaulted to max: 10, and /api/brief alone issues up to 13
// concurrent queries (fewer now that Task 8 caches it), so a couple of
// simultaneous Command Center loads could saturate the pool and queue.
// statement_timeout (sent as a per-connection `SET` at connect time — pg's
// own ClientConfig/PoolConfig option, not a manual `SET` query) protects
// against a runaway/blocked query holding a connection forever. The AI
// routes (Agent 2-4 analysis, run-agent4, proposal generation) that
// legitimately take a long time are Node-side long — they call out to
// Anthropic over HTTP and poll/write short SQL statements around that call —
// not a single long-running SQL statement, so none of them are affected by
// a 15s *statement* timeout. Migrations (migrate.ts) share this pool too;
// every table here is tiny (audit data: the largest is a few thousand rows
// at real production scale) and every migration statement is a plain
// CREATE INDEX / small DELETE, nowhere near 15s.
const POOL_TUNING = {
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
};

export const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, ...POOL_TUNING }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'electrical_crm',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASS     || 'postgres',
        ...POOL_TUNING,
      }
);
