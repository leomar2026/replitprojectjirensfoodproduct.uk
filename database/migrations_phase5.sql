-- Phase 5 Migration: Security hardening — audit_logs enhancements
-- Idempotent: safe to run multiple times.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id    INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_role  VARCHAR(20);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_name  ON audit_logs (user_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
