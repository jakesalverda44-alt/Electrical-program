import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Explicit pool sizing: the pg default of 10 can queue up under load now that
// background work (webhook dispatch, AI pipeline, reminder scans) shares the
// pool with request handlers.
const max = Number(process.env.PG_POOL_MAX) || 20;

export const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'electrical_crm',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASS     || 'postgres',
        max,
      }
);
