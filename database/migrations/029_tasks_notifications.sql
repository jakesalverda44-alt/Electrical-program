-- Phase 2B: follow-up tasks + in-app notifications.

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  notes        TEXT,
  due_date     DATE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  linked_type  TEXT,           -- 'bid' | 'gen' | 'customer'
  linked_id    UUID,
  linked_name  TEXT,
  assigned_to  UUID REFERENCES users(id),
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON tasks (assigned_to, status);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks (due_date, status);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link_view  TEXT,            -- which app view to open
  link_id    UUID,
  read       BOOLEAN NOT NULL DEFAULT false,
  dedup_key  TEXT,            -- prevents duplicate reminders
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx ON notifications (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);
