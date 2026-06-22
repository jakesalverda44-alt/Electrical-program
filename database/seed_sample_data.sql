-- ─────────────────────────────────────────────────────────────────────────────
-- LOCAL SANDBOX SAMPLE DATA  (obviously fake — every record is prefixed
-- [SAMPLE]/[DEMO]/[TEST]). Safe to re-run: it clears its own prior sample rows
-- first (matched by the prefixes) so it never duplicates.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- Clean any previously-seeded sample rows (idempotent re-run).
DELETE FROM won_jobs            WHERE customer ~ '^\[(SAMPLE|DEMO|TEST)\]';
DELETE FROM projects            WHERE name    ~ '^\[(SAMPLE|DEMO|TEST)\]';
DELETE FROM lead_activity       WHERE lead_id IN (SELECT id FROM leads WHERE name ~ '^\[(SAMPLE|DEMO|TEST)\]');
DELETE FROM leads               WHERE name     ~ '^\[(SAMPLE|DEMO|TEST)\]';
DELETE FROM generator_proposals WHERE customer ~ '^\[(SAMPLE|DEMO|TEST)\]';
DELETE FROM bids                WHERE name     ~ '^\[(SAMPLE|DEMO|TEST)\]';
DELETE FROM customers           WHERE name     ~ '^\[(SAMPLE|DEMO|TEST)\]';

-- ── Customers ───────────────────────────────────────────────────────────────
INSERT INTO customers (name, type, company, contact_name, email, phone, city, state, owner_id)
SELECT v.name, v.type, v.company, v.contact_name, v.email, v.phone, v.city, v.state, u.id
FROM (VALUES
  ('[SAMPLE] Acme Builders Inc',    'gc',       '[SAMPLE] Acme Builders Inc',  'Pat Placeholder',  'pat@example.test',   '555-0100', 'Springfield', 'FL'),
  ('[DEMO] Globex Construction',    'gc',       '[DEMO] Globex Construction',  'Sam Sample',       'sam@example.test',   '555-0101', 'Shelbyville', 'FL'),
  ('[TEST] Initech Contractors',    'gc',       '[TEST] Initech Contractors',  'Dana Demo',        'dana@example.test',  '555-0102', 'Ogdenville',  'FL'),
  ('[SAMPLE] Wayne Manufacturing',  'customer', NULL,                          'Alex Anon',        'alex@example.test',  '555-0110', 'Capital City','FL'),
  ('[DEMO] Stark Residence',        'customer', NULL,                          'Jordan Justatest', 'jordan@example.test','555-0111', 'Springfield', 'FL'),
  ('[TEST] Umbrella Storage LLC',   'customer', NULL,                          'Casey Fake',       'casey@example.test', '555-0112', 'Shelbyville', 'FL')
) AS v(name,type,company,contact_name,email,phone,city,state)
CROSS JOIN (SELECT id FROM users WHERE email = 'admin@local.test') u;

-- ── Electrical bids (stages: due / submitted / awarded / lost) ────────────────
INSERT INTO bids (name, loc, gc, due, due_days, amount, sheets, contact, stage,
                  project_type, sq_ft, salesperson_id, salesperson_name,
                  customer_id, submitted_at, awarded_at)
SELECT v.name, v.loc, v.gc, v.due, v.due_days, v.amount, v.sheets, v.contact, v.stage,
       v.project_type, v.sq_ft, u.id, u.name,
       c.id, v.submitted_at, v.awarded_at
FROM (VALUES
  ('[SAMPLE] Acme Warehouse — Electrical', '123 Test Ave, Springfield FL', '[SAMPLE] Acme Builders Inc', 'in 8 days',  8,      0.00, 14, 'Pat Placeholder', 'due',       'Commercial', 24000, NULL::timestamptz,        NULL::timestamptz),
  ('[DEMO] Globex Office Buildout',        '500 Demo Blvd, Shelbyville FL', '[DEMO] Globex Construction',  'submitted', 0, 145000.00, 22, 'Sam Sample',      'submitted', 'Commercial', 18500, now() - interval '3 days', NULL),
  ('[TEST] Initech Data Center Power',     '9 Sample Rd, Ogdenville FL',    '[TEST] Initech Contractors',  'awarded',   0, 287500.00, 41, 'Dana Demo',       'awarded',   'Industrial', 52000, now() - interval '20 days', now() - interval '10 days'),
  ('[SAMPLE] Hooli Retail Fitout',         '77 Placeholder Way, Capital City FL', '[SAMPLE] Acme Builders Inc', 'lost',  0,  92000.00, 9,  'Pat Placeholder', 'lost',      'Commercial',  6400, now() - interval '30 days', NULL)
) AS v(name,loc,gc,due,due_days,amount,sheets,contact,stage,project_type,sq_ft,submitted_at,awarded_at)
CROSS JOIN (SELECT id, name FROM users WHERE email = 'admin@local.test') u
LEFT JOIN customers c ON c.type = 'gc' AND c.name = v.gc;

-- ── Generator proposals (stages: building / sent / awarded) ───────────────────
INSERT INTO generator_proposals (customer, loc, mfr, model, kw, amount, tax, stage,
                                 built_on, addons, salesperson_id, salesperson_name, customer_id)
SELECT v.customer, v.loc, v.mfr, v.model, v.kw, v.amount, v.tax, v.stage,
       v.built_on, v.addons, u.id, u.name, c.id
FROM (VALUES
  ('[SAMPLE] Wayne Manufacturing', '123 Test Ave, Springfield FL',  'Kohler',  '38RCLB',   38.0,      0.00,    0.00, 'building', 'Just now',    0),
  ('[DEMO] Stark Residence',       '500 Demo Blvd, Shelbyville FL', 'Generac', 'RG02224',  22.0,  18500.00, 1295.00, 'sent',     '2 days ago',  1),
  ('[TEST] Umbrella Storage LLC',  '9 Sample Rd, Ogdenville FL',    'Kohler',  '150REOZK', 150.0, 96000.00, 6720.00, 'awarded',  '3 weeks ago', 2)
) AS v(customer,loc,mfr,model,kw,amount,tax,stage,built_on,addons)
CROSS JOIN (SELECT id, name FROM users WHERE email = 'admin@local.test') u
LEFT JOIN customers c ON c.type = 'customer' AND c.name = v.customer;

-- ── Generator leads (every stage) ─────────────────────────────────────────────
INSERT INTO leads (name, email, phone, address, source, contact_method,
                   interest_level, stage, notes, quoted_range, follow_up_date,
                   salesperson_id, salesperson_name)
SELECT v.name, v.email, v.phone, v.address, v.source, v.contact_method,
       v.interest_level, v.stage, v.notes, v.quoted_range, v.follow_up_date,
       u.id, u.name
FROM (VALUES
  ('[SAMPLE] Foo Bar LLC',        'foo@example.test',     '555-0200', '1 Fake St, Springfield FL',   'web',      'email', 'warm',           'new',            'Inbound web form — whole-home backup.',      NULL,         (CURRENT_DATE + 2)),
  ('[DEMO] Baz Corp',             'baz@example.test',     '555-0201', '2 Sample Ct, Shelbyville FL',  'phone',    'phone', 'unknown',        'contacted',      'Left voicemail, awaiting callback.',         NULL,         (CURRENT_DATE + 1)),
  ('[TEST] Qux Industries',       'qux@example.test',     '555-0202', '3 Demo Ln, Ogdenville FL',     'referral', 'phone', 'hot',            'contacted',      'Referred by an existing customer.',          NULL,         (CURRENT_DATE + 3)),
  ('[SAMPLE] Widgets R Us',       'widgets@example.test', '555-0203', '4 Placeholder Pkwy, Capital City FL', 'web', 'email', 'hot',           'site-scheduled', 'Sent ballpark range, wants a site visit.',   '$15k–$20k',  (CURRENT_DATE + 5)),
  ('[DEMO] Gizmo Co',             'gizmo@example.test',   '555-0204', '5 Test Blvd, Springfield FL',  'phone',    'phone', 'warm',           'site-scheduled', 'Site visit booked for next week.',           '$22k–$28k',  (CURRENT_DATE + 7)),
  ('[TEST] Contoso Ltd',          'contoso@example.test', '555-0205', '6 Sample Sq, Shelbyville FL',  'web',      'email', 'hot',            'converted',      'Converted to a generator proposal.',         '$30k–$35k',  NULL),
  ('[SAMPLE] Fabrikam Inc',       'fab@example.test',     '555-0206', '7 Demo Dr, Ogdenville FL',     'referral', 'phone', 'hot',            'converted',      'Signed! Handed off to install.',             '$40k',       NULL),
  ('[DEMO] Northwind Traders',    'north@example.test',   '555-0207', '8 Fake Fwy, Capital City FL',  'web',      'email', 'not-interested', 'lost',           'Went with another vendor.',                  NULL,         NULL)
) AS v(name,email,phone,address,source,contact_method,interest_level,stage,notes,quoted_range,follow_up_date)
CROSS JOIN (SELECT id, name FROM users WHERE email = 'admin@local.test') u;

-- A little timeline activity on a couple of leads so the detail drawer isn't empty.
INSERT INTO lead_activity (lead_id, kind, text, created_at)
SELECT l.id, 'note', 'Initial inbound inquiry logged.', now() - interval '2 days'
FROM leads l WHERE l.name = '[TEST] Qux Industries';
INSERT INTO lead_activity (lead_id, kind, text, created_at)
SELECT l.id, 'call', 'Discussed sizing and budget on a call.', now() - interval '1 day'
FROM leads l WHERE l.name = '[TEST] Qux Industries';
INSERT INTO lead_activity (lead_id, kind, text, created_at)
SELECT l.id, 'stage_change', 'Converted to a generator proposal.', now() - interval '6 hours'
FROM leads l WHERE l.name = '[TEST] Contoso Ltd';

-- ── Projects + won jobs for the awarded bid and awarded generator ─────────────
-- Projects mirror their source bid/gen id (1:1), per migration 037.
INSERT INTO projects (id, source_type, customer_id, name, contract_value, status, awarded_at)
SELECT b.id, 'elec', b.customer_id, b.name, b.amount, 'active', b.awarded_at
FROM bids b WHERE b.name = '[TEST] Initech Data Center Power';

INSERT INTO projects (id, source_type, customer_id, name, contract_value, status, awarded_at)
SELECT g.id, 'gen', g.customer_id, '[TEST] Umbrella Storage — Generator', g.amount + g.tax, 'active', now() - interval '15 days'
FROM generator_proposals g WHERE g.customer = '[TEST] Umbrella Storage LLC';

-- Won jobs (drives the sales dashboard / reporting). The two awarded records
-- above plus a few historical wins spread over recent months.
INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, date_won, salesperson_id)
SELECT u.name, '[TEST] Initech Contractors', b.id::text, 'Electrical', b.amount, (CURRENT_DATE - 10), u.id
FROM bids b CROSS JOIN (SELECT id, name FROM users WHERE email='admin@local.test') u
WHERE b.name = '[TEST] Initech Data Center Power';

INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, date_won, salesperson_id)
SELECT u.name, '[TEST] Umbrella Storage LLC', g.id::text, 'Generator', g.amount + g.tax, (CURRENT_DATE - 15), u.id
FROM generator_proposals g CROSS JOIN (SELECT id, name FROM users WHERE email='admin@local.test') u
WHERE g.customer = '[TEST] Umbrella Storage LLC';

INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, date_won, salesperson_id)
SELECT u.name, v.customer, v.proposal_id, v.proposal_type, v.value, v.date_won, u.id
FROM (VALUES
  ('[SAMPLE] Acme Builders Inc',  'SAMPLE-WON-0001', 'Electrical', 64250.00,  (CURRENT_DATE - 45)),
  ('[DEMO] Globex Construction',  'SAMPLE-WON-0002', 'Generator',  21800.00,  (CURRENT_DATE - 72)),
  ('[SAMPLE] Wayne Manufacturing','SAMPLE-WON-0003', 'Electrical', 118900.00, (CURRENT_DATE - 110))
) AS v(customer,proposal_id,proposal_type,value,date_won)
CROSS JOIN (SELECT id, name FROM users WHERE email='admin@local.test') u;

COMMIT;
