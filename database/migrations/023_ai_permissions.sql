-- Add per-user AI override
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_override JSONB;

-- Add user_id attribution to activity table
ALTER TABLE activity ADD COLUMN IF NOT EXISTS user_id UUID;

-- Seed AI permission defaults
INSERT INTO app_settings (key, value) VALUES
  ('ai_enabled',              'true'),
  ('ai_analysis_enabled',     'true'),
  ('ai_daily_limit_per_user', '10'),
  ('ai_role_permissions', '{
    "owner":           {"run_analysis":true,  "manage_settings":true,  "view_results":true },
    "administrator":   {"run_analysis":true,  "manage_settings":true,  "view_results":true },
    "estimator":       {"run_analysis":true,  "manage_settings":false, "view_results":true },
    "sales_manager":   {"run_analysis":false, "manage_settings":false, "view_results":true },
    "salesperson":     {"run_analysis":false, "manage_settings":false, "view_results":false},
    "project_manager": {"run_analysis":false, "manage_settings":false, "view_results":true },
    "technician":      {"run_analysis":false, "manage_settings":false, "view_results":false},
    "accounting":      {"run_analysis":false, "manage_settings":false, "view_results":false},
    "read_only":       {"run_analysis":false, "manage_settings":false, "view_results":false}
  }')
ON CONFLICT (key) DO NOTHING;
