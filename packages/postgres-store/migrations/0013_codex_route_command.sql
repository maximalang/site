ALTER TABLE agent_world.hub_command_receipts
  DROP CONSTRAINT hub_command_receipts_kind_check,
  ADD CONSTRAINT hub_command_receipts_kind_check CHECK (kind IN (
    'PROVIDER_CREATE', 'ACCOUNT_CREATE', 'CANONICAL_MODEL_CREATE',
    'MODEL_ROUTE_CREATE', 'CODEX_ROUTE_CREATE', 'AGENT_CREATE',
    'SKILL_CREATE', 'TOOL_CREATE', 'PROJECT_CREATE'
  ));
