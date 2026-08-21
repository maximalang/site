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
import styles from "./hub-panel.module.css";
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
  {
    id: "registry",
    label: "Реестр",
    title: "Карта сущностей",
    description:
      "Провайдеры, модели и агенты — в центре; вспомогательные реестры собраны компактно.",
  },
  {
    id: "setup",
    label: "Настройка",
    title: "Сборка конфигурации",
    description:
      "Аккаунты, миссия, provisioning и connection собраны как последовательная рабочая зона.",
  },
  {
    id: "runtime",
    label: "Runtime",
    title: "Живое выполнение",
    description: "Операционное состояние и интеграции без смешивания с настройкой сущностей.",
  },
  {
    id: "memory",
    label: "Memory",
    title: "Память проекта",
    description: "Поиск и граф памяти остаются отдельной фокусной поверхностью.",
  },
  {
    id: "automation",
    label: "Автоматизация",
    title: "Ритм агентов",
    description:
      "Native chat profile и расписания рядом, чтобы настройка переходила в повторяемое выполнение.",
  },
  {
    id: "routing",
    label: "Маршруты",
    title: "Маршрутизация выполнения",
    description:
      "Credentials, route check и execution preferences читаются как единый поток принятия решений.",
  },
] as const;

type HubSection = (typeof HUB_SECTIONS)[number]["id"];

type HubRequest = {
  attempt: number;
  load: LoadHub;
  promise: Promise<HubReadModel>;
};

function HubSectionIcon({ section }: { section: HubSection }) {
  if (section === "registry") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <path d="M14 17h6M17 14v6" strokeLinecap="round" />
      </svg>
    );
  }
  if (section === "setup") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M5 7h14M5 17h14" strokeLinecap="round" />
        <circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="15" cy="17" r="2.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (section === "runtime") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M4 15l4-5 4 3 4-7 4 3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 20h16" strokeLinecap="round" />
      </svg>
    );
  }
  if (section === "memory") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M7 5h9a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7a2 2 0 0 1 2-2Z" />
        <path d="M8 9h8M8 13h6" strokeLinecap="round" />
      </svg>
    );
  }
  if (section === "automation") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="7" />
        <path d="M12 8v4l3 2M5 5l2 2M19 5l-2 2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="17" r="2" />
      <circle cx="18" cy="7" r="2" />
      <path d="M8 7h8M7 9v4a4 4 0 0 0 4 4h5" strokeLinecap="round" />
    </svg>
  );
}

function HubSectionLead({ section }: { section: HubSection }) {
  const definition = HUB_SECTIONS.find((item) => item.id === section) ?? HUB_SECTIONS[0];
  return (
    <header className={styles.sectionLead}>
      <span className={styles.sectionLeadIcon}>
        <HubSectionIcon section={section} />
      </span>
      <div>
        <h2>{definition.title}</h2>
        <p>{definition.description}</p>
      </div>
    </header>
  );
}

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
    <div className={`${styles.panel} hub-panel`}>
      <div className={`${styles.intro} workspace-intro hub-intro`}>
        <div>
          <p className="eyebrow">Управление</p>
          <h1>Canonical Hub</h1>
        </div>
        <p>Рабочее пространство сущностей, Runtime, памяти, автоматизации и маршрутов.</p>
      </div>
      <div className={`${styles.workspace} hub-workspace-shell`}>
        <nav
          ref={navigationRef}
          aria-label="Разделы Hub"
          className={`${styles.navigation} hub-section-nav`}
        >
          <div
            aria-label="Разделы Canonical Hub"
            className={`${styles.tabs} hub-section-tabs`}
            role="tablist"
          >
            {HUB_SECTIONS.map((section) => {
              const selected = activeSection === section.id;
              return (
                <button
                  ref={(node) => {
                    tabRefs.current[section.id] = node;
                  }}
                  aria-controls={`${navigationId}-${section.id}-panel`}
                  aria-selected={selected}
                  className={styles.tab}
                  id={`${navigationId}-${section.id}-tab`}
                  key={section.id}
                  onClick={() => selectSection(section.id)}
                  onKeyDown={handleTabKey}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  <span className={styles.tabIcon}>
                    <HubSectionIcon section={section.id} />
                  </span>
                  <span className={styles.tabLabel}>{section.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className={`${styles.panels} hub-section-panels`}>
          {HUB_SECTIONS.map((section) => {
            const selected = activeSection === section.id;
            const visited = visitedSections.has(section.id);
            return (
              <section
                aria-labelledby={`${navigationId}-${section.id}-tab`}
                className={`${styles.sectionPanel} hub-section-panel`}
                hidden={!selected}
                id={`${navigationId}-${section.id}-panel`}
                key={section.id}
                role="tabpanel"
              >
                {visited ? (
                  <div
                    className={`${styles.sectionContent} hub-section-content`}
                    data-hub-section={section.id}
                  >
                    <HubSectionLead section={section.id} />
                    <div className={styles.sectionCanvas} data-hub-section={section.id}>
                      {renderSectionContent(section.id)}
                    </div>
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
