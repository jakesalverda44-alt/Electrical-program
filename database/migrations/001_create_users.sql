CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('salesperson','manager','accounting')),
  created_at TIMESTAMPTZ DEFAULT now()
);
