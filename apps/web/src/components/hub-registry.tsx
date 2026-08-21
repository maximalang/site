import type { AgentId } from "@agent-world/domain";
import type { HubReadModel } from "@agent-world/read-model";
import styles from "./hub-registry.module.css";
import { OfficePawn } from "./openclaw-office-primitives";

function Empty({ children }: { children: string }) {
  return <p className={`${styles.empty} hub-empty`}>{children}</p>;
}

function routeCount(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? "маршрутов"
      : mod10 === 1
        ? "маршрут"
        : mod10 >= 2 && mod10 <= 4
          ? "маршрута"
          : "маршрутов";
  return `${value} ${noun}`;
}

type EntityKind = "provider" | "model" | "agent" | "account" | "route" | "registry";

function EntityIcon({ kind }: { kind: EntityKind }) {
  if (kind === "provider") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M6 8h12v8H6z" />
        <path d="M9 5v3M15 5v3M9 16v3M15 16v3" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "model") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="3" />
        <circle cx="5" cy="7" r="2" />
        <circle cx="19" cy="7" r="2" />
        <circle cx="5" cy="17" r="2" />
        <circle cx="19" cy="17" r="2" />
        <path d="M7 8l3 2M17 8l-3 2M7 16l3-2M17 16l-3-2" />
      </svg>
    );
  }
  if (kind === "agent") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="8" r="3" />
        <path d="M6 19q1-6 6-6t6 6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "account") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect x="4" y="6" width="16" height="12" rx="3" />
        <path d="M8 10h8M8 14h5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "route") {
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
        <path d="M8 7h3a3 3 0 0 1 3 3v4a3 3 0 0 0 3 3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 7h14M5 12h14M5 17h14" strokeLinecap="round" />
    </svg>
  );
}

function RegistrySection({
  title,
  empty,
  values,
}: {
  title: string;
  empty: string;
  values: { id: string; primary: string; secondary: string }[];
}) {
  return (
    <section className={styles.secondarySection} aria-labelledby={`hub-${title}`}>
      <div className={styles.secondaryTitle}>
        <h3 id={`hub-${title}`}>{title}</h3>
        <span className={styles.secondaryCount}>{values.length}</span>
      </div>
      {values.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className={`${styles.compactList} hub-compact-list`}>
          {values.map((value) => (
            <li key={value.id}>
              <strong>{value.primary}</strong>
              <span>{value.secondary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryCell({
  kind,
  value,
  label,
}: {
  kind: EntityKind;
  value: string | number;
  label: string;
}) {
  return (
    <div className={styles.summaryCell}>
      <span className={styles.summaryIcon}>
        <EntityIcon kind={kind} />
      </span>
      <span className={styles.summaryCopy}>
        <strong>{value}</strong>
        <span>{label}</span>
      </span>
    </div>
  );
}

function PrimaryHeading({
  kind,
  title,
  count,
  id,
}: {
  kind: EntityKind;
  title: string;
  count: number;
  id: string;
}) {
  return (
    <div className={`${styles.sectionHeading} hub-section-heading`}>
      <div className={styles.sectionTitle}>
        <span className={styles.sectionTitleIcon}>
          <EntityIcon kind={kind} />
        </span>
        <h2 id={id}>{title}</h2>
      </div>
      <span className="count-badge">{count}</span>
    </div>
  );
}

export function HubRegistry({
  model,
  onSelectAgent,
}: {
  model: HubReadModel;
  onSelectAgent: (agentId: AgentId) => void;
}) {
  const registry = [
    [
      "Аккаунты",
      "Аккаунты пока не добавлены",
      model.accounts.map((item) => ({
        id: item.accountId,
        primary: item.label,
        secondary: `${item.authMechanism} · ${item.health}`,
      })),
    ],
    [
      "Маршруты выполнения",
      "Маршруты выполнения пока не добавлены",
      model.executionRoutes.map((item) => ({
        id: item.routeId,
        primary: item.label,
        secondary: `${item.mode} · ${item.adapterKind}`,
      })),
    ],
    [
      "Навыки",
      "Навыки пока не добавлены",
      model.skills.map((item) => ({
        id: item.skillId,
        primary: item.displayName,
        secondary: `v${item.version} · ${item.sourceKind}`,
      })),
    ],
    [
      "Инструменты",
      "Инструменты пока не добавлены",
      model.tools.map((item) => ({
        id: item.toolId,
        primary: item.displayName,
        secondary: item.kind,
      })),
    ],
    [
      "Проекты",
      "Проекты пока не добавлены",
      model.projects.map((item) => ({
        id: item.projectId,
        primary: item.name,
        secondary: `${item.agentIds.length} агентов`,
      })),
    ],
  ] satisfies [string, string, { id: string; primary: string; secondary: string }[]][];

  return (
    <div className={styles.registry}>
      <section className={styles.summaryStrip} aria-label="Сводка реестра Hub">
        <SummaryCell kind="provider" label="Провайдеры" value={model.providers.length} />
        <SummaryCell kind="model" label="Модели" value={model.models.length} />
        <SummaryCell kind="agent" label="Агенты" value={model.agents.length} />
        <SummaryCell
          kind="route"
          label="Аккаунты / маршруты"
          value={`${model.accounts.length} / ${model.executionRoutes.length}`}
        />
      </section>

      <section
        className={`${styles.primaryGrid} hub-primary-grid`}
        aria-label="Основные объекты Hub"
      >
        <section
          className={`${styles.primarySection} hub-registry-section`}
          aria-labelledby="hub-providers"
        >
          <PrimaryHeading
            count={model.providers.length}
            id="hub-providers"
            kind="provider"
            title="Провайдеры"
          />
          {model.providers.length === 0 ? (
            <Empty>Провайдеры пока не добавлены</Empty>
          ) : (
            <ul className={styles.entityList}>
              {model.providers.map((provider) => (
                <li className={styles.entityCard} key={provider.providerId}>
                  <strong>{provider.displayName}</strong>
                  <span>{provider.category}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className={`${styles.primarySection} hub-registry-section hub-models`}
          aria-labelledby="hub-models"
        >
          <PrimaryHeading
            count={model.models.length}
            id="hub-models"
            kind="model"
            title="Канонические модели"
          />
          {model.models.length === 0 ? (
            <Empty>Канонические модели пока не добавлены</Empty>
          ) : (
            <ul className={`${styles.modelList} hub-model-list`}>
              {model.models.map((item) => (
                <li className={styles.modelCard} key={item.modelId}>
                  <div className={`${styles.modelHeading} hub-model-heading`}>
                    <div>
                      <h3>{item.displayName}</h3>
                      <span className={styles.modelFamily}>{item.family}</span>
                    </div>
                    <span className="route-count">{routeCount(item.routes.length)}</span>
                  </div>
                  <p className={styles.modelDescription}>
                    Автовыбор использует вложенный ModelRoute без дублирования канонической модели.
                  </p>
                  <details>
                    <summary>Параметры маршрутов</summary>
                    <ul className={`${styles.routeList} hub-route-list`}>
                      {item.routes.map((route) => (
                        <li key={route.modelRouteId}>
                          <strong>{route.remoteModelId}</strong>
                          <span>
                            {route.surface} · {route.availability}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className={`${styles.primarySection} hub-registry-section`}
          aria-labelledby="hub-agents"
        >
          <PrimaryHeading count={model.agents.length} id="hub-agents" kind="agent" title="Агенты" />
          {model.agents.length === 0 ? (
            <Empty>Агенты пока не добавлены</Empty>
          ) : (
            <ul className={`${styles.agentList} hub-agent-list`}>
              {model.agents.map((agent) => (
                <li key={agent.agentId}>
                  <button
                    className={styles.agentButton}
                    onClick={() => onSelectAgent(agent.agentId)}
                    type="button"
                  >
                    <span className={styles.agentAvatar} aria-hidden="true">
                      <OfficePawn reviewing={false} seed={agent.agentId} working={false} />
                    </span>
                    <span className={styles.agentCopy}>
                      <strong>{agent.displayName}</strong>
                      <span>{agent.role}</span>
                    </span>
                    <span aria-hidden="true" className={styles.agentArrow}>
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <section className={`${styles.secondaryShelf} hub-secondary-grid`} aria-label="Реестры Hub">
        <header className={styles.secondaryHeader}>
          <h2>Связанные реестры</h2>
          <p>Вторичные сущности не конкурируют с провайдерами, моделями и агентами.</p>
        </header>
        <div className={styles.secondaryGrid}>
          <RegistrySection
            empty="Транспортные возможности недоступны"
            title="Состояние транспорта"
            values={model.transportCapabilities.map((capability) => ({
              id: capability.mode,
              primary: capability.mode,
              secondary: `${capability.support} · ${
                capability.selectable ? "доступен для выбора" : "недоступен для выбора"
              }`,
            }))}
          />
          {registry.map(([title, empty, values]) => (
            <RegistrySection empty={empty} key={title} title={title} values={values} />
          ))}
        </div>
      </section>
    </div>
  );
}
