CREATE TABLE agent_world.world_event_stream (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_sequence bigint NOT NULL CHECK (last_sequence >= 0)
);

INSERT INTO agent_world.world_event_stream (singleton, last_sequence)
VALUES (true, 0);

CREATE TABLE agent_world.world_events (
  sequence bigint NOT NULL UNIQUE CHECK (sequence > 0),
  id text PRIMARY KEY CHECK (id ~ '^event_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  occurred_at timestamptz NOT NULL,
  source_kind text NOT NULL CHECK (source_kind = 'RUNTIME'),
  adapter_kind text NOT NULL CHECK (adapter_kind = 'OPENCLAW'),
  binding_id text NOT NULL,
  external_event_id text NOT NULL CHECK (
    char_length(external_event_id) BETWEEN 1 AND 512
    AND external_event_id !~ '[[:cntrl:]]'
  ),
  event_type text NOT NULL CHECK (event_type = 'AGENT_STATUS_CHANGED'),
  agent_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'IDLE', 'QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'BLOCKED', 'FAILED', 'OFFLINE'
  )),
  FOREIGN KEY (binding_id, agent_id, adapter_kind)
    REFERENCES agent_world.runtime_bindings(id, agent_id, adapter_kind) ON DELETE RESTRICT,
  UNIQUE (adapter_kind, binding_id, external_event_id)
);

CREATE INDEX world_events_replay
  ON agent_world.world_events (sequence, id);

CREATE TABLE agent_world.world_agent_status (
  agent_id text PRIMARY KEY REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN (
    'IDLE', 'QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'BLOCKED', 'FAILED', 'OFFLINE'
  )),
  last_event_id text NOT NULL REFERENCES agent_world.world_events(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL
);
