"use client";

import type {
  ExecutionPreferenceLayer,
  ExecutionPreferenceReadModel,
  ExecutionPreferenceSelection,
  HubReadModel,
} from "@agent-world/read-model";
import { useEffect, useMemo, useState } from "react";
import {
  loadExecutionPreferences,
  writeExecutionPreferences,
} from "../client/execution-preference-api";

type Overrides = ExecutionPreferenceLayer["overrides"];
type ScopeKind = "SYSTEM" | "PROJECT" | "AGENT";

export type ExecutionPreferenceClient = {
  load(selection: ExecutionPreferenceSelection): Promise<ExecutionPreferenceReadModel>;
  write(input: { layer: ExecutionPreferenceLayer; csrfToken: string }): Promise<void>;
};

const defaultClient: ExecutionPreferenceClient = {
  load: (selection) => loadExecutionPreferences(selection),
  write: (input) => writeExecutionPreferences(input),
};

function sourceLabel(source: ExecutionPreferenceLayer["scope"]): string {
  switch (source.kind) {
    case "SYSTEM":
      return "System Defaults";
    case "PROJECT":
      return "Project";
    case "AGENT":
      return "Agent";
    case "TASK":
      return "Task";
    case "RUN":
      return "Run";
  }
}

function provenanceLabel(
  source: ExecutionPreferenceLayer["scope"],
  local: ExecutionPreferenceLayer["scope"],
): string {
  const label = sourceLabel(source);
  if (source.kind === local.kind) {
    return source.kind === "SYSTEM" ? "Источник: System Defaults" : `Override at ${label}`;
  }
  return `Inherited from ${label}`;
}

function modelValue(value: Overrides["model"]): string {
  if (!value) return "INHERIT";
  return value.kind === "AUTO" ? "AUTO" : value.modelId;
}

function accountValue(value: Overrides["account"]): string {
  if (!value) return "INHERIT";
  return value.kind === "AUTO" ? "AUTO" : value.accountId;
}

export function ExecutionPreferencesPanel({
  hub,
  csrfToken,
  client = defaultClient,
}: {
  hub: HubReadModel;
  csrfToken: string;
  client?: ExecutionPreferenceClient;
}) {
  const activeProjects = hub.projects.filter((project) => !project.isArchived);
  const [scopeKind, setScopeKind] = useState<ScopeKind>("SYSTEM");
  const [projectId, setProjectId] = useState<HubReadModel["projects"][number]["projectId"] | "">(
    activeProjects[0]?.projectId ?? "",
  );
  const project = activeProjects.find((item) => item.projectId === projectId);
  const availableAgents = useMemo(
    () =>
      project ? hub.agents.filter((agent) => project.agentIds.includes(agent.agentId)) : hub.agents,
    [hub.agents, project],
  );
  const [agentId, setAgentId] = useState<HubReadModel["agents"][number]["agentId"] | "">(
    availableAgents[0]?.agentId ?? "",
  );
  const [model, setModel] = useState<ExecutionPreferenceReadModel>();
  const [draft, setDraft] = useState<Overrides>({});
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (availableAgents.some((agent) => agent.agentId === agentId)) return;
    setAgentId(availableAgents[0]?.agentId ?? "");
  }, [agentId, availableAgents]);

  const selection = useMemo<ExecutionPreferenceSelection | undefined>(() => {
    if (scopeKind === "SYSTEM") return {};
    if (scopeKind === "PROJECT") return projectId ? { projectId } : undefined;
    if (!agentId) return undefined;
    return projectId ? { projectId, agentId } : { agentId };
  }, [agentId, projectId, scopeKind]);
  useEffect(() => {
    let active = true;
    setError(false);
    setModel(undefined);
    if (!selection) return;
    void client
      .load(selection)
      .then((next) => {
        if (!active) return;
        setModel(next);
        setDraft(next.local.overrides);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [client, selection]);

  async function persist(next: Overrides) {
    if (!model || !csrfToken) return;
    setSaving(true);
    setError(false);
    try {
      await client.write({
        csrfToken,
        layer: { schemaVersion: 1, scope: model.local.scope, overrides: next },
      });
      if (selection) {
        const refreshed = await client.load(selection);
        setModel(refreshed);
        setDraft(refreshed.local.overrides);
      }
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function reset(key: keyof Overrides) {
    const next = { ...draft };
    delete next[key];
    void persist(next);
  }

  const localRequired = model?.local.scope.kind === "SYSTEM";

  return (
    <section className="preference-panel" aria-labelledby="execution-preferences-title">
      <div className="hub-section-heading">
        <div>
          <p className="eyebrow">Policy</p>
          <h2 id="execution-preferences-title">Execution preferences</h2>
        </div>
        <span className="count-badge">5</span>
      </div>
      <p className="preference-lead">
        Хранятся только локальные overrides; effective значения вычисляются по цепочке наследования.
      </p>
      <div className="preference-scope-grid">
        <label>
          Уровень
          <select
            value={scopeKind}
            onChange={(event) => setScopeKind(event.target.value as ScopeKind)}
          >
            <option value="SYSTEM">System Defaults</option>
            <option disabled={!projectId} value="PROJECT">
              Project
            </option>
            <option disabled={!agentId} value="AGENT">
              Agent
            </option>
          </select>
        </label>
        <label>
          Проект
          <select
            value={projectId}
            onChange={(event) =>
              setProjectId(
                activeProjects.find((item) => item.projectId === event.target.value)?.projectId ??
                  "",
              )
            }
            disabled={activeProjects.length === 0}
          >
            {activeProjects.length === 0 ? <option value="">Нет проектов</option> : null}
            {activeProjects.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Агент
          <select
            value={agentId}
            onChange={(event) =>
              setAgentId(
                availableAgents.find((item) => item.agentId === event.target.value)?.agentId ?? "",
              )
            }
            disabled={availableAgents.length === 0}
          >
            {availableAgents.length === 0 ? <option value="">Нет агентов</option> : null}
            {availableAgents.map((item) => (
              <option key={item.agentId} value={item.agentId}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!selection ? <p className="hub-empty">Выберите существующий scope.</p> : null}
      {selection && !model && !error ? (
        <p className="hub-empty" aria-busy="true">
          Читаем policy snapshot…
        </p>
      ) : null}
      {error ? (
        <p className="preference-error" role="alert">
          Настройки не сохранены. Проверьте scope и повторите.
        </p>
      ) : null}
      {model ? (
        <div className="preference-fields">
          <PreferenceField
            label="Model"
            source={provenanceLabel(model.resolved.model.source, model.local.scope)}
            canReset={!localRequired && draft.model !== undefined}
            onReset={() => reset("model")}
          >
            <select
              aria-label="Model override"
              value={modelValue(draft.model)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ...(event.target.value === "INHERIT"
                    ? { model: undefined }
                    : {
                        model:
                          event.target.value === "AUTO"
                            ? { kind: "AUTO" }
                            : { kind: "MODEL", modelId: event.target.value as never },
                      }),
                }))
              }
            >
              {!localRequired ? <option value="INHERIT">Inherited</option> : null}
              <option value="AUTO">Auto</option>
              {hub.models
                .filter((item) => item.isEnabled)
                .map((item) => (
                  <option key={item.modelId} value={item.modelId}>
                    {item.displayName}
                  </option>
                ))}
            </select>
          </PreferenceField>
          <PreferenceField
            label="Account"
            source={provenanceLabel(model.resolved.account.source, model.local.scope)}
            canReset={!localRequired && draft.account !== undefined}
            onReset={() => reset("account")}
          >
            <select
              aria-label="Account override"
              value={accountValue(draft.account)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ...(event.target.value === "INHERIT"
                    ? { account: undefined }
                    : {
                        account:
                          event.target.value === "AUTO"
                            ? { kind: "AUTO" }
                            : { kind: "ACCOUNT", accountId: event.target.value as never },
                      }),
                }))
              }
            >
              {!localRequired ? <option value="INHERIT">Inherited</option> : null}
              <option value="AUTO">Auto</option>
              {hub.accounts
                .filter((item) => item.isEnabled)
                .map((item) => (
                  <option key={item.accountId} value={item.accountId}>
                    {item.label}
                  </option>
                ))}
            </select>
          </PreferenceField>
          <PreferenceField
            label="Mode"
            source={provenanceLabel(model.resolved.mode.source, model.local.scope)}
            canReset={!localRequired && draft.mode !== undefined}
            onReset={() => reset("mode")}
          >
            <select
              aria-label="Mode override"
              value={draft.mode ?? "INHERIT"}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  mode:
                    event.target.value === "INHERIT" ? undefined : (event.target.value as never),
                }))
              }
            >
              {!localRequired ? <option value="INHERIT">Inherited</option> : null}
              {["AUTO", "CHAT", "WORK", "CODEX", "API", "LOCAL"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </PreferenceField>
          <PreferenceField
            label="Context"
            source={provenanceLabel(model.resolved.context.source, model.local.scope)}
            canReset={!localRequired && draft.context !== undefined}
            onReset={() => reset("context")}
          >
            <select
              aria-label="Context override"
              value={draft.context ?? "INHERIT"}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  context:
                    event.target.value === "INHERIT" ? undefined : (event.target.value as never),
                }))
              }
            >
              {!localRequired ? <option value="INHERIT">Inherited</option> : null}
              {["AUTO", "LEAN", "BALANCED", "RICH"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </PreferenceField>
          <PreferenceField
            label="Budget"
            source={provenanceLabel(model.resolved.budget.source, model.local.scope)}
            canReset={!localRequired && draft.budget !== undefined}
            onReset={() => reset("budget")}
          >
            <select
              aria-label="Budget override"
              value={draft.budget ?? "INHERIT"}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  budget:
                    event.target.value === "INHERIT" ? undefined : (event.target.value as never),
                }))
              }
            >
              {!localRequired ? <option value="INHERIT">Inherited</option> : null}
              {["AUTO", "ECONOMY", "BALANCED", "QUALITY"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </PreferenceField>
          <button
            className="primary-button preference-save"
            disabled={saving || !csrfToken}
            onClick={() => void persist(draft)}
            type="button"
          >
            {saving ? "Сохраняем…" : "Сохранить overrides"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PreferenceField({
  label,
  source,
  canReset,
  onReset,
  children,
}: {
  label: string;
  source: string;
  canReset: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="preference-field">
      <div className="preference-field-control">
        {label}
        {children}
      </div>
      <span>{source}</span>
      <button disabled={!canReset} onClick={onReset} type="button">
        Reset to inherited
      </button>
    </div>
  );
}
