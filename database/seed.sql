-- User accounts only — all business data (bids, proposals, won jobs) is entered through the app.
-- Password for both accounts: password123
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Jake Salverda', 'jake@accuratepower.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uP/eWAjNG', 'manager'),
  ('David Marsh',   'david@accuratepower.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uP/eWAjNG', 'salesperson');
