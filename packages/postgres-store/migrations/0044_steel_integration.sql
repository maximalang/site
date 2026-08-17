ALTER TABLE agent_world.integration_endpoints
  DROP CONSTRAINT integration_endpoints_kind_check,
  ADD CONSTRAINT integration_endpoints_kind_check
    CHECK (kind IN ('MCP', 'N8N', 'GITHUB', 'SSH', 'STEEL'));
