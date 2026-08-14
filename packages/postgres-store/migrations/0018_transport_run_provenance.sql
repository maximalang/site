ALTER TABLE agent_world.execution_routes
  ADD CONSTRAINT execution_routes_run_provenance_key
  UNIQUE NULLS NOT DISTINCT (id, account_id, adapter_kind, mode);

ALTER TABLE agent_world.runs
  ALTER COLUMN binding_id DROP NOT NULL,
  ALTER COLUMN session_id DROP NOT NULL,
  ADD COLUMN route_id text,
  ADD COLUMN account_id text,
  ADD COLUMN execution_mode text;

UPDATE agent_world.runs AS run
   SET route_id = dispatch.route_id,
       account_id = dispatch.account_id,
       execution_mode = dispatch.mode,
       binding_id = NULL,
       session_id = NULL
  FROM agent_world.native_chat_dispatches AS dispatch
 WHERE run.id = dispatch.run_id
   AND run.adapter_kind = 'NATIVE_CHATGPT';

ALTER TABLE agent_world.runs
  ADD CONSTRAINT runs_route_provenance_fkey
    FOREIGN KEY (route_id, account_id, adapter_kind, execution_mode)
    REFERENCES agent_world.execution_routes(id, account_id, adapter_kind, mode)
    ON DELETE RESTRICT,
  ADD CONSTRAINT runs_transport_provenance_shape_check CHECK (
    (adapter_kind = 'NATIVE_CHATGPT'
      AND binding_id IS NULL AND session_id IS NULL
      AND route_id IS NOT NULL AND account_id IS NOT NULL
      AND execution_mode = 'CHAT')
    OR
    (adapter_kind <> 'NATIVE_CHATGPT'
      AND binding_id IS NOT NULL AND session_id IS NOT NULL
      AND route_id IS NULL AND account_id IS NULL AND execution_mode IS NULL)
  );

CREATE INDEX runs_native_chat_route
  ON agent_world.runs (route_id, account_id, created_at, id)
  WHERE adapter_kind = 'NATIVE_CHATGPT';
