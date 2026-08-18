ALTER TABLE agent_world.memory_proposals
  DROP CONSTRAINT memory_proposals_status_check,
  ADD CONSTRAINT memory_proposals_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'MERGED', 'SUPERSEDED', 'REJECTED'));

ALTER TABLE agent_world.memory_curation_decisions
  DROP CONSTRAINT memory_curation_decisions_action_check,
  DROP CONSTRAINT memory_curation_decisions_check,
  ADD CONSTRAINT memory_curation_decisions_action_check
    CHECK (action IN ('ACCEPT', 'MERGE', 'SUPERSEDE', 'REJECT')),
  ADD CONSTRAINT memory_curation_decisions_check CHECK (
    (action = 'ACCEPT' AND target_context_item_id IS NULL
      AND materialized_context_item_id IS NOT NULL) OR
    (action = 'MERGE' AND target_context_item_id IS NOT NULL
      AND materialized_context_item_id = target_context_item_id) OR
    (action = 'SUPERSEDE' AND target_context_item_id IS NOT NULL
      AND materialized_context_item_id IS NOT NULL
      AND materialized_context_item_id <> target_context_item_id) OR
    (action = 'REJECT' AND target_context_item_id IS NULL
      AND materialized_context_item_id IS NULL)
  );

ALTER TABLE agent_world.memory_events
  ADD COLUMN target_context_item_id text;

ALTER TABLE agent_world.memory_events
  ADD CONSTRAINT memory_events_target_project_fkey
    FOREIGN KEY (target_context_item_id, project_id)
    REFERENCES agent_world.context_items(id, project_id) ON DELETE RESTRICT;

ALTER TABLE agent_world.memory_events
  DROP CONSTRAINT memory_events_action_check,
  DROP CONSTRAINT memory_events_check,
  ADD CONSTRAINT memory_events_action_check
    CHECK (action IN ('ACCEPT', 'MERGE', 'SUPERSEDE', 'REJECT')),
  ADD CONSTRAINT memory_events_check CHECK (
    (event_type = 'MEMORY_PROPOSED' AND decision_id IS NULL AND action IS NULL
      AND target_context_item_id IS NULL AND materialized_context_item_id IS NULL) OR
    (event_type = 'MEMORY_CURATED' AND decision_id IS NOT NULL AND action IS NOT NULL
      AND (
        (action = 'ACCEPT' AND target_context_item_id IS NULL
          AND materialized_context_item_id IS NOT NULL) OR
        (action = 'MERGE' AND target_context_item_id IS NOT NULL
          AND materialized_context_item_id = target_context_item_id) OR
        (action = 'SUPERSEDE' AND target_context_item_id IS NOT NULL
          AND materialized_context_item_id IS NOT NULL
          AND materialized_context_item_id <> target_context_item_id) OR
        (action = 'REJECT' AND target_context_item_id IS NULL
          AND materialized_context_item_id IS NULL)
      ))
  );
