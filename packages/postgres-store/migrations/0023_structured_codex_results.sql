ALTER TABLE agent_world.codex_execution_jobs
  ADD COLUMN structured_result jsonb,
  ADD COLUMN result_parse_status text CHECK (
    result_parse_status IS NULL OR result_parse_status IN ('VALIDATED', 'RAW_FALLBACK')
  );

UPDATE agent_world.codex_execution_jobs
   SET result_parse_status = 'RAW_FALLBACK'
 WHERE final_output IS NOT NULL;

ALTER TABLE agent_world.codex_execution_jobs
  ADD CONSTRAINT codex_execution_jobs_structured_result_shape_check CHECK (
    (final_output IS NULL AND structured_result IS NULL AND result_parse_status IS NULL)
    OR
    (final_output IS NOT NULL AND result_parse_status = 'RAW_FALLBACK'
      AND structured_result IS NULL)
    OR
    (final_output IS NOT NULL AND result_parse_status = 'VALIDATED'
      AND jsonb_typeof(structured_result) = 'object')
  );
