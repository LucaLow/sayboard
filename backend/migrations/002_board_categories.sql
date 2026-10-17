-- Deliberate storage schema upgrade. Existing board JSON and revisions stay intact.
-- Run after 001_postgres.sql on new databases, or alone on existing schema v1.
BEGIN;
DO $$
DECLARE current_version INTEGER;
BEGIN
  SELECT version INTO current_version FROM sayboard.schema_version
    WHERE singleton = TRUE FOR UPDATE;
  IF current_version IS NULL OR current_version NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Unsupported Sayboard schema version';
  END IF;
END $$;
ALTER TABLE sayboard.boards DROP CONSTRAINT IF EXISTS boards_payload_check;
ALTER TABLE sayboard.boards ADD CONSTRAINT boards_payload_check CHECK (
  jsonb_typeof(payload) = 'object' AND
  (payload @> '{"version":1}'::jsonb OR payload @> '{"version":2}'::jsonb)
);
UPDATE sayboard.schema_version SET version = 2 WHERE singleton = TRUE;
COMMIT;
