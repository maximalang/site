"use client";

import type { AgentId } from "@agent-world/domain";
import type { HubReadModel } from "@agent-world/read-model";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { loadHubReadModel } from "../client/hub-api";
import { AgentProvisioningPanel } from "./agent-provisioning-panel";
import { ChatGptAccountPanel } from "./chatgpt-account-panel";
import {
  type ExecutionPreferenceClient,
  ExecutionPreferencesPanel,
} from "./execution-preferences-panel";
import { HubRegistry } from "./hub-registry";
import { IntegrationPanel } from "./integration-panel";
import { MemoryCenter, type MemoryCenterClient } from "./memory-center";
import { MissionPanel } from "./mission-panel";
import { ModelExecutionConnectionPanel } from "./model-execution-connection-panel";
import { ModelRouteCheckPanel } from "./model-route-check-panel";
import { type NativeChatProfileClient, NativeChatProfilePanel } from "./native-chat-profile-panel";
import { OperationsPanel } from "./operations-panel";
import { ProviderCredentialForm } from "./provider-credential-form";
import { type ScheduleClient, SchedulePanel } from "./schedule-panel";

type LoadHub = (attempt: number) => Promise<HubReadModel>;
const defaultLoadHub: LoadHub = () => loadHubReadModel();

const HUB_SECTIONS = [
  { id: "registry", label: "Реестр" },
  { id: "setup", label: "Настройка" },
  { id: "runtime", label: "Runtime" },
  { id: "memory", label: "Memory" },
  { id: "automation", label: "Автоматизация" },
  { id: "routing", label: "Маршруты" },
] as const;

type HubSection = (typeof HUB_SECTIONS)[number]["id"];

type HubRequest = {
  attempt: number;
  load: LoadHub;
  promise: Promise<HubReadModel>;
};

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
  const [activeSection, setActiveSection] = useState<HubSection>("registry");
  const navigationId = useId();
  const requestRef = useRef<HubRequest | undefined>(undefined);
  const tabRefs = useRef<Record<HubSection, HTMLButtonElement | null>>({
    registry: null,
    setup: null,
    runtime: null,
    memory: null,
    automation: null,
    routing: null,
  });

  useEffect(() => {
    let active = true;
    setError(false);
    if (
      !requestRef.current ||
      requestRef.current.attempt !== attempt ||
      requestRef.current.load !== load
    ) {
      requestRef.current = { attempt, load, promise: load(attempt) };
    }
    void requestRef.current.promise
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

  const selectSection = (section: HubSection, focus = false) => {
    setActiveSection(section);
    if (focus) tabRefs.current[section]?.focus();
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = HUB_SECTIONS.findIndex((section) => section.id === activeSection);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + offset + HUB_SECTIONS.length) % HUB_SECTIONS.length;
      selectSection(HUB_SECTIONS[nextIndex]?.id ?? "registry", true);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectSection("registry", true);
    } else if (event.key === "End") {
      event.preventDefault();
      selectSection("routing", true);
    }
  };

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

  const activeTabId = `${navigationId}-${activeSection}-tab`;
  const activePanelId = `${navigationId}-${activeSection}-panel`;

  return (
    <div className="hub-panel">
      <div className="workspace-intro hub-intro">
        <div>
          <p className="eyebrow">Lobby</p>
          <h1>Canonical Hub</h1>
        </div>
        <p>Управление сущностями, runtime, памятью, автоматизацией и маршрутами.</p>
      </div>
      <div className="hub-workspace-shell">
        <nav aria-label="Разделы Hub" className="hub-section-nav">
          <div aria-label="Разделы Canonical Hub" className="hub-section-tabs" role="tablist">
            {HUB_SECTIONS.map((section) => {
              const selected = activeSection === section.id;
              return (
                <button
                  ref={(node) => {
                    tabRefs.current[section.id] = node;
                  }}
                  aria-controls={`${navigationId}-${section.id}-panel`}
                  aria-selected={selected}
                  id={`${navigationId}-${section.id}-tab`}
                  key={section.id}
                  onClick={() => selectSection(section.id)}
                  onKeyDown={handleTabKey}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        <section
          aria-labelledby={activeTabId}
          className="hub-section-panel"
          id={activePanelId}
          role="tabpanel"
        >
          <div className="hub-section-content" data-hub-section={activeSection}>
            {activeSection === "registry" ? (
              <HubRegistry model={model} onSelectAgent={onSelectAgent} />
            ) : null}

            {activeSection === "setup" ? (
              <>
                <ChatGptAccountPanel
                  accounts={model.accounts}
                  csrfToken={csrfToken}
                  onCreated={() => setAttempt((value) => value + 1)}
                  providers={model.providers}
                />
                <MissionPanel csrfToken={csrfToken} projects={model.projects} />
                <AgentProvisioningPanel
                  csrfToken={csrfToken}
                  onConfigureSchedule={() => selectSection("automation")}
                  onProvisioned={(agentId) => {
                    setProvisionedAgentId(agentId);
                    setAttempt((value) => value + 1);
                  }}
                  projects={model.projects}
                  skills={model.skills}
                  tools={model.tools}
                />
                <ModelExecutionConnectionPanel
                  csrfToken={csrfToken}
                  model={model}
                  onProvisioned={() => setAttempt((value) => value + 1)}
                />
              </>
            ) : null}

            {activeSection === "runtime" ? (
              <>
                <OperationsPanel />
                <IntegrationPanel csrfToken={csrfToken} />
              </>
            ) : null}

            {activeSection === "memory" ? (
              <MemoryCenter
                {...(memoryClient ? { client: memoryClient } : {})}
                csrfToken={csrfToken}
                projects={model.projects}
              />
            ) : null}

            {activeSection === "automation" ? (
              <>
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
              </>
            ) : null}

            {activeSection === "routing" ? (
              <>
                <ProviderCredentialForm csrfToken={csrfToken} model={model} />
                <ModelRouteCheckPanel csrfToken={csrfToken} model={model} />
                <ExecutionPreferencesPanel
                  {...(preferenceClient ? { client: preferenceClient } : {})}
                  csrfToken={csrfToken}
                  hub={model}
                />
              </>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
