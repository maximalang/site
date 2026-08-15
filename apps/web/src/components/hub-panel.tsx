"use client";

import type { AgentId } from "@agent-world/domain";
import type { HubReadModel } from "@agent-world/read-model";
import { useEffect, useState } from "react";
import { loadHubReadModel } from "../client/hub-api";
import { AgentProvisioningPanel } from "./agent-provisioning-panel";
import {
  type ExecutionPreferenceClient,
  ExecutionPreferencesPanel,
} from "./execution-preferences-panel";
import { HubRegistry } from "./hub-registry";
import { IntegrationPanel } from "./integration-panel";
import { MemoryCenter, type MemoryCenterClient } from "./memory-center";
import { MissionPanel } from "./mission-panel";
import { ModelRouteCheckPanel } from "./model-route-check-panel";
import { type NativeChatProfileClient, NativeChatProfilePanel } from "./native-chat-profile-panel";
import { OperationsPanel } from "./operations-panel";
import { ProviderCredentialForm } from "./provider-credential-form";
import { type ScheduleClient, SchedulePanel } from "./schedule-panel";

type LoadHub = (attempt: number) => Promise<HubReadModel>;
const defaultLoadHub: LoadHub = () => loadHubReadModel();

export function HubPanel({
  load = defaultLoadHub,
  onSelectAgent,
  csrfToken = "",
  preferenceClient,
  nativeChatProfileClient,
  memoryClient,
  scheduleClient,
}: {
  load?: LoadHub;
  onSelectAgent: (agentId: AgentId) => void;
  csrfToken?: string;
  preferenceClient?: ExecutionPreferenceClient;
  nativeChatProfileClient?: NativeChatProfileClient;
  memoryClient?: MemoryCenterClient;
  scheduleClient?: ScheduleClient;
}) {
  const [model, setModel] = useState<HubReadModel>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [provisionedAgentId, setProvisionedAgentId] = useState<string>();

  useEffect(() => {
    let active = true;
    setError(false);
    void load(attempt)
      .then((next) => {
        if (active) setModel(next);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, load]);

  if (error) {
    return (
      <section className="hub-state" role="alert">
        <p className="eyebrow">Ошибка API</p>
        <h1>Hub недоступен</h1>
        <p>Приватные или непроверенные данные не отображаются.</p>
        <button
          className="primary-button"
          onClick={() => setAttempt((value) => value + 1)}
          type="button"
        >
          Повторить
        </button>
      </section>
    );
  }

  if (!model) {
    return (
      <section className="hub-state" aria-busy="true" aria-label="Загрузка Hub">
        <span aria-hidden="true" className="loading-grid" />
        <h1>Загружаем Canonical Hub</h1>
        <p>Читаем один owner-only PostgreSQL snapshot.</p>
      </section>
    );
  }

  return (
    <div className="hub-panel">
      <div className="workspace-intro hub-intro">
        <div>
          <p className="eyebrow">Lobby</p>
          <h1>Canonical Hub</h1>
        </div>
        <p>Agent, Account и Model остаются разными физическими сущностями.</p>
      </div>
      <HubRegistry model={model} onSelectAgent={onSelectAgent} />
      <MissionPanel csrfToken={csrfToken} projects={model.projects} />
      <AgentProvisioningPanel
        csrfToken={csrfToken}
        onProvisioned={(agentId) => {
          setProvisionedAgentId(agentId);
          setAttempt((value) => value + 1);
        }}
        projects={model.projects}
        skills={model.skills}
        tools={model.tools}
      />
      <OperationsPanel />
      <IntegrationPanel csrfToken={csrfToken} />
      <MemoryCenter
        {...(memoryClient ? { client: memoryClient } : {})}
        csrfToken={csrfToken}
        projects={model.projects}
      />
      <NativeChatProfilePanel
        {...(nativeChatProfileClient ? { client: nativeChatProfileClient } : {})}
        csrfToken={csrfToken}
        hub={model}
      />
      <SchedulePanel
        {...(scheduleClient ? { client: scheduleClient } : {})}
        csrfToken={csrfToken}
        hub={model}
        {...(provisionedAgentId ? { focusAgentId: provisionedAgentId } : {})}
      />
      <ProviderCredentialForm csrfToken={csrfToken} model={model} />
      <ModelRouteCheckPanel csrfToken={csrfToken} model={model} />
      <ExecutionPreferencesPanel
        {...(preferenceClient ? { client: preferenceClient } : {})}
        csrfToken={csrfToken}
        hub={model}
      />
    </div>
  );
}
