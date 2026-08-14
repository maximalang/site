CREATE SCHEMA IF NOT EXISTS agent_world_oauth;

CREATE TABLE agent_world_oauth.oidc_store (
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 512),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz,
  consumed_at timestamptz,
  grant_id text,
  user_code text,
  uid text,
  PRIMARY KEY (model, id)
);

CREATE INDEX native_chat_oauth_grant_idx
  ON agent_world_oauth.oidc_store (model, grant_id)
  WHERE grant_id IS NOT NULL;
CREATE INDEX native_chat_oauth_user_code_idx
  ON agent_world_oauth.oidc_store (model, user_code)
  WHERE user_code IS NOT NULL;
CREATE INDEX native_chat_oauth_uid_idx
  ON agent_world_oauth.oidc_store (model, uid)
  WHERE uid IS NOT NULL;
CREATE INDEX native_chat_oauth_expires_idx
  ON agent_world_oauth.oidc_store (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE agent_world_oauth.login_throttle (
  throttle_key text PRIMARY KEY CHECK (char_length(throttle_key) BETWEEN 1 AND 512),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE agent_world_oauth.account_grants (
  grant_id text PRIMARY KEY CHECK (char_length(grant_id) BETWEEN 1 AND 512),
  client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 512),
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX native_chat_oauth_account_grants_active
  ON agent_world_oauth.account_grants (account_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION agent_world_oauth.reject_oidc_update_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('agent_world.oauth_maintenance', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'OAuth state deletion requires the bounded maintenance flag';
END;
$$;

CREATE TRIGGER oidc_store_delete_guard
BEFORE DELETE ON agent_world_oauth.oidc_store
FOR EACH ROW EXECUTE FUNCTION agent_world_oauth.reject_oidc_update_delete();
