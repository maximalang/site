import type { AgentId } from "@agent-world/domain";
import type { HubReadModel } from "@agent-world/read-model";

function Empty({ children }: { children: string }) {
  return <p className="hub-empty">{children}</p>;
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
    <section className="hub-registry-section" aria-labelledby={`hub-${title}`}>
      <div className="hub-section-heading">
        <h2 id={`hub-${title}`}>{title}</h2>
        <span className="count-badge">{values.length}</span>
      </div>
      {values.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="hub-compact-list">
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
    <>
      <section className="hub-primary-grid" aria-label="Основные объекты Hub">
        <RegistrySection
          empty="Провайдеры пока не добавлены"
          title="Провайдеры"
          values={model.providers.map((provider) => ({
            id: provider.providerId,
            primary: provider.displayName,
            secondary: provider.category,
          }))}
        />
        <section className="hub-registry-section hub-models" aria-labelledby="hub-models">
          <div className="hub-section-heading">
            <h2 id="hub-models">Канонические модели</h2>
            <span className="count-badge">{model.models.length}</span>
          </div>
          {model.models.length === 0 ? (
            <Empty>Канонические модели пока не добавлены</Empty>
          ) : (
            <ul className="hub-model-list">
              {model.models.map((item) => (
                <li key={item.modelId}>
                  <div className="hub-model-heading">
                    <div>
                      <h3>{item.displayName}</h3>
                      <span>{item.family}</span>
                    </div>
                    <span className="route-count">{routeCount(item.routes.length)}</span>
                  </div>
                  <p>Автовыбор использует один из вложенных ModelRoute без дублирования карточки.</p>
                  <details>
                    <summary>Параметры маршрутов</summary>
                    <ul className="hub-route-list">
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
        <section className="hub-registry-section" aria-labelledby="hub-agents">
          <div className="hub-section-heading">
            <h2 id="hub-agents">Агенты</h2>
            <span className="count-badge">{model.agents.length}</span>
          </div>
          {model.agents.length === 0 ? (
            <Empty>Агенты пока не добавлены</Empty>
          ) : (
            <ul className="hub-agent-list">
              {model.agents.map((agent) => (
                <li key={agent.agentId}>
                  <button onClick={() => onSelectAgent(agent.agentId)} type="button">
                    <strong>{agent.displayName}</strong>
                    <span>{agent.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
      <section className="hub-secondary-grid" aria-label="Реестры Hub">
        <RegistrySection
          empty="Транспортные возможности недоступны"
          title="Состояние транспорта"
          values={model.transportCapabilities.map((capability) => ({
            id: capability.mode,
            primary: capability.mode,
            secondary: `${capability.support} · ${capability.selectable ? "доступен для выбора" : "недоступен для выбора"}`,
          }))}
        />
        {registry.map(([title, empty, values]) => (
          <RegistrySection empty={empty} key={title} title={title} values={values} />
        ))}
      </section>
    </>
  );
}
