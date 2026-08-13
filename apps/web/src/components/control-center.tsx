"use client";

import {
  type AgentProjectionCore,
  projectCommandView,
  projectWorldView,
  type WorldReadModel,
} from "@agent-world/read-model";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadWorldReadModel } from "../client/world-api";
import { type ConversationClient, ConversationDrawer } from "./conversation-drawer";
import { HubPanel } from "./hub-panel";
import { type TaskClient, TaskDrawer } from "./task-drawer";
import { WorldCanvas } from "./world-canvas";

type Mode = "WORLD" | "COMMAND" | "HUB";
type LoadReadModel = (attempt: number) => Promise<WorldReadModel>;
type LoadHubReadModel = () => Promise<import("@agent-world/read-model").HubReadModel>;
type AgentId = AgentProjectionCore["agentId"];
const defaultLoadReadModel: LoadReadModel = () => loadWorldReadModel();

const STATUS_COPY: Record<AgentProjectionCore["status"], string> = {
  IDLE: "Свободен",
  QUEUED: "В очереди",
  RUNNING: "Выполняет",
  WAITING_APPROVAL: "Ждёт подтверждения",
  BLOCKED: "Заблокирован",
  FAILED: "Ошибка",
  OFFLINE: "Не в сети",
};

function StatusBadge({ status }: { status: AgentProjectionCore["status"] }) {
  return (
    <span className="status-badge" data-status={status}>
      <span aria-hidden="true" className="status-dot" />
      {STATUS_COPY[status]}
    </span>
  );
}

function AgentInspector({
  agent,
  onOpenConversation,
  onAssignTask,
}: {
  agent: AgentProjectionCore | undefined;
  onOpenConversation: (agentId: AgentId) => void;
  onAssignTask: (agentId: AgentId) => void;
}) {
  if (!agent) {
    return (
      <section className="inspector empty-inspector" aria-label="Карточка агента">
        <p className="eyebrow">Контекст</p>
        <h2>Выберите агента</h2>
        <p>Карта и таблица открывают одну и ту же каноническую карточку.</p>
      </section>
    );
  }

  return (
    <section className="inspector" aria-labelledby="agent-inspector-title">
      <div className="inspector-heading">
        <div>
          <p className="eyebrow">Agent</p>
          <h2 id="agent-inspector-title">{agent.displayName}</h2>
        </div>
        <StatusBadge status={agent.status} />
      </div>
      <p className="agent-role">{agent.role}</p>
      <dl className="agent-facts">
        <div>
          <dt>Состояние</dt>
          <dd>{STATUS_COPY[agent.status]}</dd>
        </div>
        <div>
          <dt>Текущая задача</dt>
          <dd>{agent.currentTask?.title ?? "Нет активной задачи"}</dd>
        </div>
        {agent.currentTask ? (
          <div>
            <dt>Подтверждение</dt>
            <dd>{agent.currentTask.approval}</dd>
          </div>
        ) : null}
      </dl>
      <p className="inspector-note">Runtime-сессии и credentials не входят в эту проекцию.</p>
      <button
        className="primary-button inspector-chat-button"
        onClick={() => onOpenConversation(agent.agentId)}
        type="button"
      >
        Открыть диалог
      </button>
      <button
        className="secondary-button inspector-chat-button"
        onClick={() => onAssignTask(agent.agentId)}
        type="button"
      >
        Назначить задачу
      </button>
    </section>
  );
}

function AgentRoster({
  agents,
  selectedAgentId,
  onSelect,
  onOpenConversation,
}: {
  agents: AgentProjectionCore[];
  selectedAgentId: AgentId | undefined;
  onSelect: (agentId: AgentId) => void;
  onOpenConversation: (agentId: AgentId) => void;
}) {
  return (
    <section className="world-roster" aria-labelledby="world-roster-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Roster</p>
          <h2 id="world-roster-title">Агенты</h2>
        </div>
        <span className="count-badge">{agents.length}</span>
      </div>
      <ul className="agent-list">
        {agents.map((agent) => (
          <li key={agent.agentId}>
            <button
              className="agent-list-button"
              data-selected={agent.agentId === selectedAgentId}
              onClick={() => onSelect(agent.agentId)}
              onDoubleClick={() => onOpenConversation(agent.agentId)}
              type="button"
            >
              <span>
                <strong>{agent.displayName}</strong>
                <small>{agent.role}</small>
              </span>
              <StatusBadge status={agent.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommandTable({
  agents,
  selectedAgentId,
  onSelect,
  onOpenConversation,
  onAssignTask,
}: {
  agents: AgentProjectionCore[];
  selectedAgentId: AgentId | undefined;
  onSelect: (agentId: AgentId) => void;
  onOpenConversation: (agentId: AgentId) => void;
  onAssignTask: (agentId: AgentId) => void;
}) {
  return (
    <section className="command-panel" aria-labelledby="command-agents-title">
      <div className="section-heading command-heading">
        <div>
          <p className="eyebrow">Canonical fleet</p>
          <h2 id="command-agents-title">Состояние агентов</h2>
        </div>
        <p>{agents.length} подключено к общей проекции</p>
      </div>
      <section className="table-scroll" aria-label="Таблица состояния агентов">
        <table>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Статус</th>
              <th scope="col">Задача</th>
              <th scope="col">Действие</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr data-selected={agent.agentId === selectedAgentId} key={agent.agentId}>
                <th scope="row">
                  <strong>{agent.displayName}</strong>
                  <small>{agent.role}</small>
                </th>
                <td>
                  <StatusBadge status={agent.status} />
                </td>
                <td>{agent.currentTask?.title ?? "—"}</td>
                <td>
                  <div className="command-row-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        onSelect(agent.agentId);
                        onOpenConversation(agent.agentId);
                      }}
                      type="button"
                    >
                      Диалог
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        onSelect(agent.agentId);
                        onAssignTask(agent.agentId);
                      }}
                      type="button"
                    >
                      Задача
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

export function ControlCenter({
  csrfToken,
  loadReadModel = defaultLoadReadModel,
  loadHubReadModel,
  conversationClient,
  taskClient,
  onLogout,
}: {
  csrfToken: string;
  loadReadModel?: LoadReadModel;
  loadHubReadModel?: LoadHubReadModel;
  conversationClient?: ConversationClient;
  taskClient?: TaskClient;
  onLogout?: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<Mode>("WORLD");
  const [model, setModel] = useState<WorldReadModel>();
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>();
  const [conversationAgentId, setConversationAgentId] = useState<AgentId>();
  const [taskAgentId, setTaskAgentId] = useState<AgentId>();
  const [logoutState, setLogoutState] = useState<"IDLE" | "PENDING" | "ERROR">("IDLE");
  const worldTabId = useId();
  const commandTabId = useId();
  const hubTabId = useId();
  const worldTabRef = useRef<HTMLButtonElement>(null);
  const commandTabRef = useRef<HTMLButtonElement>(null);
  const hubTabRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLoadError(false);
    void loadReadModel(reloadNonce)
      .then((next) => {
        if (active) {
          setModel(next);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [loadReadModel, reloadNonce]);

  const world = useMemo(() => (model ? projectWorldView(model) : undefined), [model]);
  const command = useMemo(() => (model ? projectCommandView(model) : undefined), [model]);
  const agents = useMemo(() => (command?.agents ?? []).map((agent) => agent.core), [command]);
  const selectedAgent = agents.find((agent) => agent.agentId === selectedAgentId);

  const selectAgent = useCallback((agentId: AgentId) => {
    setSelectedAgentId(agentId);
  }, []);

  const openConversation = useCallback((agentId: AgentId) => {
    setSelectedAgentId(agentId);
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setConversationAgentId(agentId);
  }, []);

  const closeConversation = useCallback(() => {
    setConversationAgentId(undefined);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  const openTask = useCallback((agentId: AgentId) => {
    setSelectedAgentId(agentId);
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setTaskAgentId(agentId);
  }, []);

  const closeTask = useCallback(() => {
    setTaskAgentId(undefined);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  const conversationAgent = agents.find((agent) => agent.agentId === conversationAgentId);
  const taskAgent = agents.find((agent) => agent.agentId === taskAgentId);

  const logout = async () => {
    if (!onLogout || logoutState === "PENDING") return;
    setLogoutState("PENDING");
    try {
      await onLogout();
    } catch {
      setLogoutState("ERROR");
    }
  };

  const selectMode = (next: Mode, focus = false) => {
    setMode(next);
    if (focus) {
      ({ WORLD: worldTabRef, COMMAND: commandTabRef, HUB: hubTabRef })[next].current?.focus();
    }
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const modes: Mode[] = ["WORLD", "COMMAND", "HUB"];
      const offset = event.key === "ArrowRight" ? 1 : -1;
      selectMode(
        modes[(modes.indexOf(mode) + offset + modes.length) % modes.length] ?? "WORLD",
        true,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      selectMode("WORLD", true);
    } else if (event.key === "End") {
      event.preventDefault();
      selectMode("HUB", true);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        К содержанию
      </a>
      <header className="topbar">
        <div className="brand-lockup">
          <span aria-hidden="true" className="brand-mark">
            AW
          </span>
          <div>
            <p>Agent World</p>
            <span>Operating Environment</span>
          </div>
        </div>
        <div className="topbar-meta">
          <div className="topbar-status" aria-label="Состояние проекции" role="status">
            <span className="live-indicator" data-live={model?.source === "LIVE"}>
              <span aria-hidden="true" />
              {model?.source === "LIVE" ? "Live" : "Read-only"}
            </span>
            <span>Cursor {model?.cursor.lastSequence ?? 0}</span>
          </div>
          {onLogout ? (
            <div className="logout-control">
              {logoutState === "ERROR" ? (
                <span className="logout-error" role="alert">
                  Сессия не завершена
                </span>
              ) : null}
              <button
                className="topbar-logout"
                disabled={logoutState === "PENDING"}
                onClick={() => void logout()}
                type="button"
              >
                {logoutState === "PENDING" ? "Выходим…" : "Выйти"}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="mode-navigation" aria-label="Режим интерфейса">
        <div className="mode-tabs" role="tablist" aria-label="World, Command или Hub">
          <button
            ref={worldTabRef}
            aria-controls="world-panel"
            aria-selected={mode === "WORLD"}
            id={worldTabId}
            onClick={() => selectMode("WORLD")}
            onKeyDown={handleTabKey}
            role="tab"
            tabIndex={mode === "WORLD" ? 0 : -1}
            type="button"
          >
            World
          </button>
          <button
            ref={commandTabRef}
            aria-controls="command-panel"
            aria-selected={mode === "COMMAND"}
            id={commandTabId}
            onClick={() => selectMode("COMMAND")}
            onKeyDown={handleTabKey}
            role="tab"
            tabIndex={mode === "COMMAND" ? 0 : -1}
            type="button"
          >
            Command
          </button>
          <button
            ref={hubTabRef}
            aria-controls="hub-panel"
            aria-selected={mode === "HUB"}
            id={hubTabId}
            onClick={() => selectMode("HUB")}
            onKeyDown={handleTabKey}
            role="tab"
            tabIndex={mode === "HUB" ? 0 : -1}
            type="button"
          >
            Hub
          </button>
        </div>
        <p className="projection-note">Один domain layer · World, Command и Hub</p>
      </nav>

      <main id="main-content" tabIndex={-1}>
        {mode !== "HUB" && model?.source === "CONTRACT_FIXTURE" ? (
          <div className="fixture-banner" role="note">
            Контрактный снимок — это проверочные данные, не live runtime.
          </div>
        ) : null}

        {mode === "HUB" ? (
          <section
            aria-labelledby={hubTabId}
            className="hub-workspace"
            id="hub-panel"
            role="tabpanel"
          >
            <HubPanel
              csrfToken={csrfToken}
              {...(loadHubReadModel ? { load: loadHubReadModel } : {})}
              onSelectAgent={selectAgent}
            />
          </section>
        ) : null}

        {mode !== "HUB" && !model && !loadError ? (
          <section className="center-state" aria-busy="true" aria-label="Загрузка состояния">
            <span aria-hidden="true" className="loading-grid" />
            <h1>Загружаем общую проекцию</h1>
            <p>World и Command получат один и тот же cursor.</p>
          </section>
        ) : null}

        {mode !== "HUB" && loadError ? (
          <section className="center-state" role="alert">
            <p className="eyebrow">Ошибка API</p>
            <h1>Не удалось проверить read model</h1>
            <p>Ответ не используется, пока не пройдёт каноническую схему.</p>
            <button
              className="primary-button"
              onClick={() => setReloadNonce((value) => value + 1)}
              type="button"
            >
              Повторить
            </button>
          </section>
        ) : null}

        {mode !== "HUB" && model?.source === "UNAVAILABLE" ? (
          <section className="center-state" role="status" aria-label="Runtime недоступен">
            <p className="eyebrow">Нет авторитетного источника</p>
            <h1>Runtime недоступен</h1>
            <p>Интерфейс не создаёт вымышленных агентов или активность.</p>
          </section>
        ) : null}

        {mode !== "HUB" && model && model.source !== "UNAVAILABLE" && world && command ? (
          <div className="workspace-grid">
            {mode === "WORLD" ? (
              <section
                aria-labelledby={worldTabId}
                className="primary-workspace"
                id="world-panel"
                role="tabpanel"
              >
                <div className="workspace-intro">
                  <div>
                    <p className="eyebrow">Headquarters</p>
                    <h1>AI World</h1>
                  </div>
                  <p>Реальные статусы двигают проекцию. Декоративных LLM-вызовов нет.</p>
                </div>
                <div className="world-grid">
                  <div className="canvas-frame">
                    <WorldCanvas
                      agents={world.agents}
                      onOpenConversation={openConversation}
                      onSelectAgent={selectAgent}
                      selectedAgentId={selectedAgentId}
                    />
                  </div>
                  <AgentRoster
                    agents={agents}
                    onOpenConversation={openConversation}
                    onSelect={selectAgent}
                    selectedAgentId={selectedAgentId}
                  />
                </div>
              </section>
            ) : (
              <section
                aria-labelledby={commandTabId}
                className="primary-workspace"
                id="command-panel"
                role="tabpanel"
              >
                <div className="workspace-intro">
                  <div>
                    <p className="eyebrow">Control plane</p>
                    <h1>Command</h1>
                  </div>
                  <p>Операторская таблица использует тот же cursor и Agent identity.</p>
                </div>
                <CommandTable
                  agents={agents}
                  onAssignTask={openTask}
                  onOpenConversation={openConversation}
                  onSelect={selectAgent}
                  selectedAgentId={selectedAgentId}
                />
              </section>
            )}

            <AgentInspector
              agent={selectedAgent}
              onAssignTask={openTask}
              onOpenConversation={openConversation}
            />
          </div>
        ) : null}
      </main>
      {conversationAgent ? (
        <ConversationDrawer
          agent={conversationAgent}
          {...(conversationClient ? { client: conversationClient } : {})}
          csrfToken={csrfToken}
          onClose={closeConversation}
        />
      ) : null}
      {taskAgent ? (
        <TaskDrawer
          agent={taskAgent}
          {...(taskClient ? { client: taskClient } : {})}
          csrfToken={csrfToken}
          onAssigned={() => setReloadNonce((value) => value + 1)}
          onClose={closeTask}
        />
      ) : null}
    </div>
  );
}
