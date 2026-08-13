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
import { WorldCanvas } from "./world-canvas";

type Mode = "WORLD" | "COMMAND";
type LoadReadModel = (attempt: number) => Promise<WorldReadModel>;
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

function AgentInspector({ agent }: { agent: AgentProjectionCore | undefined }) {
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
    </section>
  );
}

function AgentRoster({
  agents,
  selectedAgentId,
  onSelect,
}: {
  agents: AgentProjectionCore[];
  selectedAgentId: AgentId | undefined;
  onSelect: (agentId: AgentId) => void;
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
}: {
  agents: AgentProjectionCore[];
  selectedAgentId: AgentId | undefined;
  onSelect: (agentId: AgentId) => void;
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
                  <button
                    className="text-button"
                    onClick={() => onSelect(agent.agentId)}
                    type="button"
                  >
                    Открыть
                  </button>
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
  loadReadModel = defaultLoadReadModel,
}: {
  loadReadModel?: LoadReadModel;
}) {
  const [mode, setMode] = useState<Mode>("WORLD");
  const [model, setModel] = useState<WorldReadModel>();
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>();
  const worldTabId = useId();
  const commandTabId = useId();
  const worldTabRef = useRef<HTMLButtonElement>(null);
  const commandTabRef = useRef<HTMLButtonElement>(null);

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

  const selectMode = (next: Mode, focus = false) => {
    setMode(next);
    if (focus) {
      (next === "WORLD" ? worldTabRef : commandTabRef).current?.focus();
    }
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      selectMode(mode === "WORLD" ? "COMMAND" : "WORLD", true);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectMode("WORLD", true);
    } else if (event.key === "End") {
      event.preventDefault();
      selectMode("COMMAND", true);
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
        <div className="topbar-meta" aria-label="Состояние проекции" role="status">
          <span className="live-indicator" data-live={model?.source === "LIVE"}>
            <span aria-hidden="true" />
            {model?.source === "LIVE" ? "Live" : "Read-only"}
          </span>
          <span>Cursor {model?.cursor.lastSequence ?? 0}</span>
        </div>
      </header>

      <nav className="mode-navigation" aria-label="Режим интерфейса">
        <div className="mode-tabs" role="tablist" aria-label="World или Command">
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
        </div>
        <p className="projection-note">Один read model · две проекции</p>
      </nav>

      <main id="main-content" tabIndex={-1}>
        {model?.source === "CONTRACT_FIXTURE" ? (
          <div className="fixture-banner" role="note">
            Контрактный снимок — это проверочные данные, не live runtime.
          </div>
        ) : null}

        {!model && !loadError ? (
          <section className="center-state" aria-busy="true" aria-label="Загрузка состояния">
            <span aria-hidden="true" className="loading-grid" />
            <h1>Загружаем общую проекцию</h1>
            <p>World и Command получат один и тот же cursor.</p>
          </section>
        ) : null}

        {loadError ? (
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

        {model?.source === "UNAVAILABLE" ? (
          <section className="center-state" role="status" aria-label="Runtime недоступен">
            <p className="eyebrow">Нет авторитетного источника</p>
            <h1>Runtime недоступен</h1>
            <p>Интерфейс не создаёт вымышленных агентов или активность.</p>
          </section>
        ) : null}

        {model && model.source !== "UNAVAILABLE" && world && command ? (
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
                      onSelectAgent={selectAgent}
                      selectedAgentId={selectedAgentId}
                    />
                  </div>
                  <AgentRoster
                    agents={agents}
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
                  onSelect={selectAgent}
                  selectedAgentId={selectedAgentId}
                />
              </section>
            )}

            <AgentInspector agent={selectedAgent} />
          </div>
        ) : null}
      </main>
    </div>
  );
}
