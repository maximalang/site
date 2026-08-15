"use client";
import type { IntegrationCreate, IntegrationRegistry } from "@agent-world/read-model";
import { useCallback, useEffect, useState } from "react";
import { integrationClient } from "../client/integration-api";

export type IntegrationClient = {
  list(): Promise<IntegrationRegistry>;
  create(input: IntegrationCreate, csrf: string): Promise<void>;
  credential(id: string, plaintext: string, csrf: string): Promise<void>;
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
          </li>
        ))}
      </ul>
    </section>
  );
}
