CREATE TABLE agent_world.structured_meeting_criterion_assessments (
  meeting_id text NOT NULL REFERENCES agent_world.structured_meetings(id) ON DELETE CASCADE,
  criterion_id text NOT NULL REFERENCES agent_world.mission_success_criteria(id) ON DELETE RESTRICT,
  assessment_position integer NOT NULL CHECK (assessment_position BETWEEN 0 AND 99),
  status text NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
  evidence_refs jsonb NOT NULL CHECK (
    jsonb_typeof(evidence_refs) = 'array'
    AND jsonb_array_length(evidence_refs) BETWEEN 1 AND 100
  ),
  PRIMARY KEY (meeting_id, criterion_id),
  UNIQUE (meeting_id, assessment_position)
);

CREATE INDEX structured_meeting_assessments_criterion_idx
  ON agent_world.structured_meeting_criterion_assessments (criterion_id, meeting_id);
