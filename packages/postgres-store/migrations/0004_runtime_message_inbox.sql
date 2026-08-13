CREATE UNIQUE INDEX conversation_sessions_runtime_identity
  ON agent_world.conversation_sessions (adapter_kind, binding_id, external_session_ref);

CREATE UNIQUE INDEX conversation_messages_runtime_identity
  ON agent_world.conversation_messages (adapter_kind, binding_id, external_message_id)
  WHERE author = 'AGENT';
