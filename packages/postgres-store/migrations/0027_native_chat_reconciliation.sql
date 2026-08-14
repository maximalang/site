ALTER TABLE agent_world.native_chat_dispatches
  ADD COLUMN begin_deadline_at timestamptz,
  ADD COLUMN completion_deadline_at timestamptz;

UPDATE agent_world.native_chat_dispatches
   SET begin_deadline_at = created_at + interval '30 minutes',
       completion_deadline_at = CASE
         WHEN attached_at IS NULL THEN NULL
         ELSE attached_at + interval '4 hours'
       END;

ALTER TABLE agent_world.native_chat_dispatches
  ALTER COLUMN begin_deadline_at SET NOT NULL,
  ADD CONSTRAINT native_chat_dispatches_deadline_shape_check CHECK (
    begin_deadline_at > created_at
    AND (completion_deadline_at IS NULL OR
         (attached_at IS NOT NULL AND completion_deadline_at > attached_at))
  ),
  DROP CONSTRAINT native_chat_dispatches_launcher_shape_check,
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
      AND (
        (submission_evidence_version = 0
          AND browser_profile_ref IS NULL AND submission_receipt_sha256 IS NULL)
        OR
        (submission_evidence_version = 1 AND launch_attempt > 0
          AND browser_profile_ref IS NOT NULL AND submission_receipt_sha256 IS NOT NULL)
      ))
  );

CREATE INDEX native_chat_dispatches_expired_begin
  ON agent_world.native_chat_dispatches (begin_deadline_at, id)
  WHERE state IN ('QUEUED', 'BROWSER_SUBMITTED', 'FAILED');

CREATE INDEX native_chat_dispatches_expired_completion
  ON agent_world.native_chat_dispatches (completion_deadline_at, id)
  WHERE state = 'ATTACHED' AND completion_deadline_at IS NOT NULL;
