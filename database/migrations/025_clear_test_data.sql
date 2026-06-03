-- Clear all test/demo data. Preserves users, app_settings, and all schema objects.
TRUNCATE TABLE
  takeoff_results,
  bid_workspaces,
  project_rfis,
  project_field_notes,
  project_change_orders,
  project_sections,
  communications,
  documents,
  activity,
  won_jobs,
  generator_proposals,
  bids
CASCADE;
