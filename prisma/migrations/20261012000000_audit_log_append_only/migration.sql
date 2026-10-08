-- The audit log is append-only: refuse UPDATE, DELETE and TRUNCATE on it, whoever runs them.
-- To purge old rows on purpose (retention), drop the triggers first and recreate them afterwards:
--   DROP TRIGGER "AuditLog_append_only" ON "AuditLog";
--   DROP TRIGGER "AuditLog_no_truncate" ON "AuditLog";
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();

CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_append_only"();
