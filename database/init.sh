#!/bin/bash
# Run all migrations then seed
PGPASSWORD=${DB_PASS:-postgres} psql -h ${DB_HOST:-localhost} -U ${DB_USER:-postgres} -d ${DB_NAME:-electrical_crm} \
  -f database/migrations/001_create_users.sql \
  -f database/migrations/002_create_bids.sql \
  -f database/migrations/003_create_gens.sql \
  -f database/migrations/004_create_won_jobs.sql \
  -f database/migrations/005_create_activity.sql \
  -f database/seed.sql
