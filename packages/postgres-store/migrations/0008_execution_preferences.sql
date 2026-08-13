CREATE TABLE agent_world.execution_preference_overrides (
  scope_kind text NOT NULL CHECK (scope_kind IN ('SYSTEM', 'PROJECT', 'AGENT', 'TASK')),
  project_id text REFERENCES agent_world.projects(id) ON DELETE CASCADE,
  agent_id text REFERENCES agent_world.agents(id) ON DELETE CASCADE,
  task_id text REFERENCES agent_world.tasks(id) ON DELETE CASCADE,
  scope_key text GENERATED ALWAYS AS (
    scope_kind || ':' || COALESCE(project_id, agent_id, task_id, 'system')
  ) STORED PRIMARY KEY,
  model_selection text CHECK (model_selection IN ('AUTO', 'MODEL')),
  model_id text REFERENCES agent_world.canonical_models(id) ON DELETE RESTRICT,
  account_selection text CHECK (account_selection IN ('AUTO', 'ACCOUNT')),
  account_id text REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  mode text CHECK (mode IN ('AUTO', 'CHAT', 'WORK', 'CODEX', 'API', 'LOCAL')),
  context_policy text CHECK (context_policy IN ('AUTO', 'LEAN', 'BALANCED', 'RICH')),
  budget_policy text CHECK (budget_policy IN ('AUTO', 'ECONOMY', 'BALANCED', 'QUALITY')),
  updated_at timestamptz NOT NULL,
  CHECK (
    (scope_kind = 'SYSTEM' AND project_id IS NULL AND agent_id IS NULL AND task_id IS NULL)
    OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL AND agent_id IS NULL AND task_id IS NULL)
    OR (scope_kind = 'AGENT' AND project_id IS NULL AND agent_id IS NOT NULL AND task_id IS NULL)
    OR (scope_kind = 'TASK' AND project_id IS NULL AND agent_id IS NULL AND task_id IS NOT NULL)
  ),
  CHECK (
    (model_selection IS NULL AND model_id IS NULL)
    OR model_selection = 'AUTO' AND model_id IS NULL
    OR model_selection = 'MODEL' AND model_id IS NOT NULL
  ),
  CHECK (
    (account_selection IS NULL AND account_id IS NULL)
    OR account_selection = 'AUTO' AND account_id IS NULL
    OR account_selection = 'ACCOUNT' AND account_id IS NOT NULL
  ),
  CHECK (
    model_selection IS NOT NULL OR account_selection IS NOT NULL OR mode IS NOT NULL
    OR context_policy IS NOT NULL OR budget_policy IS NOT NULL
  ),
  CHECK (
    scope_kind <> 'SYSTEM'
    OR (
      model_selection IS NOT NULL AND account_selection IS NOT NULL AND mode IS NOT NULL
      AND context_policy IS NOT NULL AND budget_policy IS NOT NULL
    )
  )
);

INSERT INTO agent_world.execution_preference_overrides (
  scope_kind, model_selection, account_selection, mode, context_policy,
  budget_policy, updated_at
)
VALUES ('SYSTEM', 'AUTO', 'AUTO', 'AUTO', 'AUTO', 'BALANCED', clock_timestamp());

CREATE INDEX execution_preference_overrides_project
  ON agent_world.execution_preference_overrides (project_id) WHERE project_id IS NOT NULL;

CREATE INDEX execution_preference_overrides_agent
  ON agent_world.execution_preference_overrides (agent_id) WHERE agent_id IS NOT NULL;

CREATE INDEX execution_preference_overrides_task
  ON agent_world.execution_preference_overrides (task_id) WHERE task_id IS NOT NULL;
