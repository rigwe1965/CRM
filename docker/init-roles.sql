-- Runs once, when the local Postgres volume is first created (docker compose up -d).
--
-- Creates the restricted role the app connects as, so row-level security binds in local development exactly as in
-- production. It exists BEFORE `npm run db:deploy`, so every migration's GRANT to it applies by itself.
-- The "crm" owner role (POSTGRES_USER) keeps running migrations and the platform client, which RLS does not bind.
-- Local development only: the password is public. Never reuse this file for a real database.
CREATE ROLE crm_app LOGIN PASSWORD 'crm_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
