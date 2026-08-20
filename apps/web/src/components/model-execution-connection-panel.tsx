"use client";

import type { HubCommandRequest, HubReadModel } from "@agent-world/read-model";
import { useMemo, useState } from "react";
import { executeHubCommand } from "../client/hub-command-api";

type ProvisionCommand = Extract<HubCommandRequest, { kind: "MODEL_AGENT_ROUTE_PROVISION" }>;

export function ModelExecutionConnectionPanel({
  model,
  csrfToken,
  client = { execute: executeHubCommand },
  onProvisioned,
}: {
  model: HubReadModel;
  csrfToken: string;
  client?: { execute(command: ProvisionCommand, csrfToken: string): Promise<unknown> };
  onProvisioned?: () => void;
}) {
  const candidates = useMemo(
    () =>
      model.models.flatMap((canonical) =>
        canonical.routes
          .filter(
            (route) =>
              route.isEnabled &&
              route.availability === "AVAILABLE" &&
              (route.surface === "API" || route.surface === "LOCAL"),
          )
          .map((route) => ({ ...route, modelName: canonical.displayName })),
      ),
    [model.models],
  );
  const [projectId, setProjectId] = useState(model.projects[0]?.projectId ?? "");
  const project = model.projects.find((item) => item.projectId === projectId);
  const agents = model.agents.filter((agent) => project?.agentIds.includes(agent.agentId));
  const [agentId, setAgentId] = useState(agents[0]?.agentId ?? "");
  const [modelRouteId, setModelRouteId] = useState(candidates[0]?.modelRouteId ?? "");
  const [title, setTitle] = useState("Выполнение модели");
  const [state, setState] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");
  const selectedRoute = candidates.find((route) => route.modelRouteId === modelRouteId);

  const submit = async () => {
    if (!selectedRoute) return;
    setState("SAVING");
    try {
      const connectionId = crypto.randomUUID();
      const routeId = `route_${crypto.randomUUID()}`;
      const conversationId = `conversation_${crypto.randomUUID()}`;
      await client.execute(
        {
          schemaVersion: 1,
          commandId: `hub_command_${connectionId}`,
          kind: "MODEL_AGENT_ROUTE_PROVISION",
          routeId,
          modelRouteId: selectedRoute.modelRouteId,
          routeLabel: `${selectedRoute.modelName} · ${selectedRoute.surface}`,
          bindingId: `binding_${connectionId}`,
          sessionId: `session_${crypto.randomUUID()}`,
          agentId,
          projectId,
          conversationId,
          conversationTitle: title,
          externalAgentId: `model-route:${agentId}`,
          externalSessionRef: `model-session:${conversationId}`,
          startedAt: new Date().toISOString(),
        } as ProvisionCommand,
        csrfToken,
      );
      setState("SAVED");
      onProvisioned?.();
    } catch {
      setState("ERROR");
    }
  };

  return (
    <section aria-labelledby="model-execution-connection-title" className="hub-control-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Маршрут агента</p>
          <h2 id="model-execution-connection-title">Подключить API / Local</h2>
        </div>
      </div>
      {state === "SAVED" ? <p role="status">Маршрут и сессия агента подключены</p> : null}
      {state === "ERROR" ? <p role="alert">Не удалось создать подключение.</p> : null}
      {candidates.length === 0 || model.projects.length === 0 ? (
        <p>Нужны доступный API/Local ModelRoute и проект с агентом.</p>
      ) : (
        <div className="hub-control-form">
          <label>
            Проект
            <select
              value={projectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                setProjectId(nextProjectId);
                const nextProject = model.projects.find((item) => item.projectId === nextProjectId);
                setAgentId(nextProject?.agentIds[0] ?? "");
              }}
            >
              {model.projects.map((item) => (
                <option key={item.projectId} value={item.projectId}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Агент
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Название сессии
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <p>Выполнение: AUTO · {selectedRoute?.modelName ?? "нет доступного маршрута"}</p>
          <details>
            <summary>Расширенные настройки</summary>
            <label>
              ModelRoute
              <select
                value={modelRouteId}
                onChange={(event) => setModelRouteId(event.target.value)}
              >
                {candidates.map((route) => (
                  <option key={route.modelRouteId} value={route.modelRouteId}>
                    {route.modelName} · {route.surface} · {route.remoteModelId}
                  </option>
                ))}
              </select>
            </label>
          </details>
          <button
            className="primary-button"
            disabled={
              state === "SAVING" || !csrfToken || !agentId || !title.trim() || !selectedRoute
            }
            onClick={() => void submit()}
            type="button"
          >
            {state === "SAVING" ? "Подключаем…" : "Подключить"}
          </button>
        </div>
      )}
    </section>
  );
}
