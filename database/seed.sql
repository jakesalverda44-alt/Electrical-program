-- User accounts only — all business data (bids, proposals, won jobs) is entered through the app.
-- Password for both accounts: password123
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Jake Salverda', 'jake@accuratepower.com', '$2a$10$bVgY0qNe1eCh8sKHdWUdhuZdlwclq/SQ8RD.ALbDD/LccoKo6DXrS', 'owner'),
  ('David Marsh',   'david@accuratepower.com', '$2a$10$bVgY0qNe1eCh8sKHdWUdhuZdlwclq/SQ8RD.ALbDD/LccoKo6DXrS', 'salesperson');
