"use client";
import type {
  IntegrationAction,
  IntegrationActionResult,
  IntegrationCreate,
  IntegrationRegistry,
} from "@agent-world/read-model";
import { useCallback, useEffect, useState } from "react";
import { integrationClient } from "../client/integration-api";

export type IntegrationClient = {
  list(): Promise<IntegrationRegistry>;
  create(input: IntegrationCreate, csrf: string): Promise<void>;
  credential(id: string, plaintext: string, csrf: string): Promise<void>;
  lifecycle(id: string, operation: "ENABLE" | "DISABLE", csrf: string): Promise<void>;
  probe(id: string, csrf: string): Promise<void>;
  action(id: string, action: IntegrationAction, csrf: string): Promise<IntegrationActionResult>;
};
export function IntegrationPanel({
  csrfToken,
  client = integrationClient,
}: {
  csrfToken: string;
  client?: IntegrationClient;
}) {
  const [registry, setRegistry] = useState<IntegrationRegistry>();
  const [error, setError] = useState(false);
  const [kind, setKind] = useState<"MCP" | "N8N" | "GITHUB" | "SSH">("MCP");
  const [label, setLabel] = useState("");
  const [locator, setLocator] = useState("");
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionResult, setActionResult] = useState<IntegrationActionResult>();
  const refresh = useCallback(
    () =>
      client
        .list()
        .then(setRegistry)
        .catch(() => setError(true)),
    [client],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const uuid = crypto.randomUUID();
      const id = `integration_${uuid}`;
      await client.create(
        {
          id,
          commandId: `integration:create:${uuid}`,
          kind,
          label,
          endpoint:
            kind === "SSH"
              ? { transport: "SSH", host: locator, port: 22, username }
              : { transport: "HTTPS", url: locator },
          createdAt: new Date().toISOString(),
        },
        csrfToken,
      );
      if (credential) await client.credential(id, credential, csrfToken);
      setCredential("");
      setLabel("");
      setLocator("");
      setUsername("");
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const lifecycle = async (id: string, operation: "ENABLE" | "DISABLE") => {
    setBusy(true);
    setError(false);
    try {
      await client.lifecycle(id, operation, csrfToken);
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const probe = async (id: string) => {
    setBusy(true);
    setError(false);
    try {
      await client.probe(id, csrfToken);
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const executeAction = async (id: string, action: IntegrationAction) => {
    setBusy(true);
    setError(false);
    try {
      setActionResult(await client.action(id, action, csrfToken));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="integrations-title" className="integrations-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MCP · Automation · Servers</p>
          <h2 id="integrations-title">Интеграции</h2>
        </div>
        <span className="count-badge">{registry?.integrations.length ?? 0}</span>
      </div>
      {error ? <p role="alert">Команда отклонена или registry недоступен.</p> : null}
      {actionResult ? (
        <div className="integration-action-result" aria-live="polite">
          <strong>{actionResult.action}</strong>
          <span>{actionResult.status}</span>
          <ul>
            {actionResult.items.map((item) => (
              <li key={item.id}>
                {item.label}
                {item.detail ? ` · ${item.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="integration-form">
        <label>
          Тип
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option>MCP</option>
            <option>N8N</option>
            <option>GITHUB</option>
            <option>SSH</option>
          </select>
        </label>
        <label>
          Название
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label>
          {kind === "SSH" ? "Host" : "HTTPS URL"}
          <input value={locator} onChange={(event) => setLocator(event.target.value)} />
        </label>
        {kind === "SSH" ? (
          <label>
            SSH user
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
        ) : null}
        <label>
          Credential
          <input
            autoComplete="new-password"
            type="password"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          />
        </label>
        <button
          className="primary-button"
          disabled={busy || !label || !locator || (kind === "SSH" && !username)}
          onClick={() => void create()}
          type="button"
        >
          {busy ? "Сохраняем…" : "Добавить"}
        </button>
      </div>
      <ul className="integration-list">
        {registry?.integrations.map((item) => (
          <li key={item.id}>
            <strong>{item.label}</strong>
            <span>
              {item.kind} · {item.health}
            </span>
            <small>
              {item.endpoint.transport === "HTTPS"
                ? item.endpoint.url
                : `${item.endpoint.username}@${item.endpoint.host}:${item.endpoint.port}`}
            </small>
            <span>{item.hasCredential ? "Credential настроен" : "Без credential"}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void lifecycle(item.id, item.isEnabled ? "DISABLE" : "ENABLE")}
            >
              {item.isEnabled ? "Отключить" : "Включить"}
            </button>
            <button
              type="button"
              disabled={busy || !item.isEnabled}
              onClick={() => void probe(item.id)}
            >
              Проверить
            </button>
            <button
              type="button"
              disabled={busy || !item.isEnabled || item.health !== "READY"}
              onClick={() =>
                void executeAction(
                  item.id,
                  (
                    {
                      MCP: "MCP_LIST_TOOLS",
                      N8N: "N8N_LIST_WORKFLOWS",
                      GITHUB: "GITHUB_LIST_REPOSITORIES",
                      SSH: "SSH_INSPECT_HOST",
                    } as const
                  )[item.kind],
                )
              }
            >
              {item.kind === "MCP"
                ? "Инструменты"
                : item.kind === "N8N"
                  ? "Workflow"
                  : item.kind === "GITHUB"
                    ? "Репозитории"
                    : "Host info"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
