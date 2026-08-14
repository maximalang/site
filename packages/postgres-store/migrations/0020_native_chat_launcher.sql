CREATE TABLE agent_world.native_chat_browser_profiles (
  account_id text PRIMARY KEY REFERENCES agent_world.accounts(id) ON DELETE CASCADE,
  profile_ref text NOT NULL UNIQUE CHECK (
    char_length(profile_ref) BETWEEN 1 AND 100
    AND profile_ref ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL
);

ALTER TABLE agent_world.native_chat_dispatches
  ADD COLUMN launch_attempt integer NOT NULL DEFAULT 0 CHECK (launch_attempt BETWEEN 0 AND 10),
  ADD COLUMN lease_owner text CHECK (
    lease_owner IS NULL OR lease_owner ~ '^launcher_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN browser_profile_ref text,
  ADD COLUMN submission_receipt_sha256 text CHECK (
    submission_receipt_sha256 IS NULL OR submission_receipt_sha256 ~ '^[a-f0-9]{64}$'
  ),
  ADD COLUMN submission_evidence_version integer NOT NULL DEFAULT 0 CHECK (
    submission_evidence_version IN (0, 1)
  ),
  ADD COLUMN last_launch_failure_code text CHECK (
    last_launch_failure_code IS NULL OR last_launch_failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  ADD CONSTRAINT native_chat_dispatches_launcher_shape_check CHECK (
    (state = 'QUEUED'
      AND browser_profile_ref IS NULL AND submission_receipt_sha256 IS NULL
      AND submission_evidence_version = 0
      AND (
        (lease_owner IS NULL AND lease_expires_at IS NULL)
        OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND launch_attempt > 0)
      ))
    OR
    (state IN ('BROWSER_SUBMITTED', 'ATTACHED')
      AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND (
        (submission_evidence_version = 0 AND launch_attempt = 0
          AND browser_profile_ref IS NULL AND submission_receipt_sha256 IS NULL)
        OR
        (submission_evidence_version = 1 AND launch_attempt > 0
          AND browser_profile_ref IS NOT NULL AND submission_receipt_sha256 IS NOT NULL)
      ))
    OR
    (state = 'FAILED'
      AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND browser_profile_ref IS NULL AND submission_receipt_sha256 IS NULL
      AND submission_evidence_version = 0)
  );

CREATE INDEX native_chat_dispatches_launcher_queue
  ON agent_world.native_chat_dispatches (created_at, id)
  WHERE state = 'QUEUED';
