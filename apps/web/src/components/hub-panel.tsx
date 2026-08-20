"use client";

import type { AgentId } from "@agent-world/domain";
import type { HubReadModel, OperationsReadModel } from "@agent-world/read-model";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { loadHubReadModel } from "../client/hub-api";
import { AgentProvisioningPanel } from "./agent-provisioning-panel";
import { ChatGptAccountPanel } from "./chatgpt-account-panel";
import {
  type ExecutionPreferenceClient,
  ExecutionPreferencesPanel,
} from "./execution-preferences-panel";
import { HubRegistry } from "./hub-registry";
import { type IntegrationClient, IntegrationPanel } from "./integration-panel";
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
  integrationClient,
  operationsLoad,
}: {
  load?: LoadHub;
  onSelectAgent: (agentId: AgentId) => void;
  csrfToken?: string;
  preferenceClient?: ExecutionPreferenceClient;
  nativeChatProfileClient?: NativeChatProfileClient;
  memoryClient?: MemoryCenterClient;
  scheduleClient?: ScheduleClient;
  integrationClient?: IntegrationClient;
  operationsLoad?: () => Promise<OperationsReadModel>;
}) {
  const [model, setModel] = useState<HubReadModel>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [provisionedAgentId, setProvisionedAgentId] = useState<string>();
  const [activeSection, setActiveSection] = useState<HubSection>("registry");
  const [visitedSections, setVisitedSections] = useState<ReadonlySet<HubSection>>(
    () => new Set<HubSection>(["registry"]),
  );
  const navigationId = useId();
  const requestRef = useRef<HubRequest | undefined>(undefined);
  const navigationRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    const navigation = navigationRef.current;
    const tab = tabRefs.current[activeSection];
    if (!navigation || !tab || navigation.scrollWidth <= navigation.clientWidth) return;

    const navigationRect = navigation.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    if (tabRect.left < navigationRect.left) {
      navigation.scrollLeft -= navigationRect.left - tabRect.left;
    } else if (tabRect.right > navigationRect.right) {
      navigation.scrollLeft += tabRect.right - navigationRect.right;
    }
  }, [activeSection]);

  const selectSection = (section: HubSection, focus = false) => {
    setVisitedSections((current) => {
      if (current.has(section)) return current;
      return new Set([...current, section]);
    });
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
        <p className="eyebrow">Ошибка загрузки</p>
        <h1>Hub недоступен</h1>
        <p>Непроверенные или закрытые данные не отображаются. Можно повторить загрузку.</p>
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
        <p>Получаем проверенное состояние, доступное владельцу.</p>
      </section>
    );
  }

  const renderSectionContent = (section: HubSection) => {
    if (section === "registry") {
      return <HubRegistry model={model} onSelectAgent={onSelectAgent} />;
    }

    if (section === "setup") {
      return (
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
            onConfigureSchedule={(agentId) => {
              setProvisionedAgentId(agentId);
              selectSection("automation", true);
            }}
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
      );
    }

    if (section === "runtime") {
      return (
        <>
          <OperationsPanel {...(operationsLoad ? { load: operationsLoad } : {})} />
          <IntegrationPanel
            {...(integrationClient ? { client: integrationClient } : {})}
            csrfToken={csrfToken}
          />
        </>
      );
    }

    if (section === "memory") {
      return (
        <MemoryCenter
          {...(memoryClient ? { client: memoryClient } : {})}
          csrfToken={csrfToken}
          projects={model.projects}
        />
      );
    }

    if (section === "automation") {
      return (
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
      );
    }

    return (
      <>
        <ProviderCredentialForm csrfToken={csrfToken} model={model} />
        <ModelRouteCheckPanel csrfToken={csrfToken} model={model} />
        <ExecutionPreferencesPanel
          {...(preferenceClient ? { client: preferenceClient } : {})}
          csrfToken={csrfToken}
          hub={model}
        />
      </>
    );
  };

  return (
    <div className="hub-panel">
      <div className="workspace-intro hub-intro">
        <div>
          <p className="eyebrow">Управление</p>
          <h1>Canonical Hub</h1>
        </div>
        <p>Управление сущностями, Runtime, памятью, автоматизацией и маршрутами.</p>
      </div>
      <div className="hub-workspace-shell">
        <nav ref={navigationRef} aria-label="Разделы Hub" className="hub-section-nav">
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

        <div className="hub-section-panels">
          {HUB_SECTIONS.map((section) => {
            const selected = activeSection === section.id;
            const visited = visitedSections.has(section.id);
            return (
              <section
                aria-labelledby={`${navigationId}-${section.id}-tab`}
                className="hub-section-panel"
                hidden={!selected}
                id={`${navigationId}-${section.id}-panel`}
                key={section.id}
                role="tabpanel"
              >
                {visited ? (
                  <div className="hub-section-content" data-hub-section={section.id}>
                    {renderSectionContent(section.id)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
