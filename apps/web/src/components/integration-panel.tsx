"use client";
import type {
  IntegrationAction,
  IntegrationActionResult,
  IntegrationCreate,
  IntegrationMutation,
  IntegrationMutationReceipt,
  IntegrationRegistry,
  IntegrationSshOperationCreate,
  IntegrationToolAllowlistCreate,
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
  registerTool(
    input: Omit<IntegrationToolAllowlistCreate, "createdAt">,
    csrf: string,
  ): Promise<void>;
  registerSshOperation(
    input:
      | Omit<
          Extract<IntegrationSshOperationCreate, { operationKind: "SYSTEMD_RESTART" }>,
          "createdAt"
        >
      | Omit<
          Extract<IntegrationSshOperationCreate, { operationKind: "DOCKER_COMPOSE_DEPLOY" }>,
          "createdAt"
        >,
    csrf: string,
  ): Promise<void>;
  requestMutation(
    id: string,
    mutation: IntegrationMutation,
    csrf: string,
  ): Promise<IntegrationMutationReceipt>;
  decideMutation(
    requestId: string,
    decision: "APPROVE" | "DENY",
    csrf: string,
  ): Promise<IntegrationMutationReceipt>;
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
  const [kind, setKind] = useState<"MCP" | "N8N" | "GITHUB" | "SSH" | "STEEL">("MCP");
  const [label, setLabel] = useState("");
  const [locator, setLocator] = useState("");
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionResult, setActionResult] = useState<IntegrationActionResult>();
  const [mutationReceipt, setMutationReceipt] = useState<IntegrationMutationReceipt>();
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepository, setGithubRepository] = useState("");
  const [githubWorkflow, setGithubWorkflow] = useState("deploy.yml");
  const [githubRef, setGithubRef] = useState("main");
  const [mcpToolLabel, setMcpToolLabel] = useState("");
  const [mcpToolName, setMcpToolName] = useState("");
  const [mcpFixedArguments, setMcpFixedArguments] = useState("{}");
  const [sshOperationKind, setSshOperationKind] = useState<
    "SYSTEMD_RESTART" | "DOCKER_COMPOSE_DEPLOY"
  >("SYSTEMD_RESTART");
  const [sshOperationLabel, setSshOperationLabel] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const [sshWorkingDirectory, setSshWorkingDirectory] = useState("");
  const [sshHostKeySha256, setSshHostKeySha256] = useState("");
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
  const requestGithubDispatch = async (id: string) => {
    setBusy(true);
    setError(false);
    try {
      setMutationReceipt(
        await client.requestMutation(
          id,
          {
            kind: "GITHUB_DISPATCH_WORKFLOW",
            owner: githubOwner,
            repository: githubRepository,
            workflowId: githubWorkflow,
            ref: githubRef,
          },
          csrfToken,
        ),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const registerMcpTool = async (integrationId: string) => {
    setBusy(true);
    setError(false);
    try {
      const uuid = crypto.randomUUID();
      const fixedArguments = JSON.parse(mcpFixedArguments) as unknown;
      if (!fixedArguments || Array.isArray(fixedArguments) || typeof fixedArguments !== "object")
        throw new Error("Fixed arguments must be an object");
      await client.registerTool(
        {
          id: `integration_tool_${uuid}`,
          integrationId,
          commandId: `integration:tool:create:${uuid}`,
          label: mcpToolLabel,
          toolName: mcpToolName,
          fixedArguments: fixedArguments as IntegrationToolAllowlistCreate["fixedArguments"],
        },
        csrfToken,
      );
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const requestMcpTool = async (integrationId: string, toolAllowlistId: string) => {
    setBusy(true);
    setError(false);
    try {
      setMutationReceipt(
        await client.requestMutation(
          integrationId,
          { kind: "MCP_CALL_REGISTERED_TOOL", toolAllowlistId },
          csrfToken,
        ),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const registerSshOperation = async (integrationId: string) => {
    setBusy(true);
    setError(false);
    try {
      const uuid = crypto.randomUUID();
      const common = {
        id: `integration_ssh_operation_${uuid}` as const,
        integrationId,
        commandId: `integration:ssh-operation:create:${uuid}`,
        label: sshOperationLabel,
        hostKeySha256: sshHostKeySha256,
      };
      await client.registerSshOperation(
        sshOperationKind === "SYSTEMD_RESTART"
          ? { ...common, operationKind: sshOperationKind, systemdUnit: sshTarget }
          : {
              ...common,
              operationKind: sshOperationKind,
              composeProject: sshTarget,
              workingDirectory: sshWorkingDirectory,
            },
        csrfToken,
      );
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const requestSshOperation = async (integrationId: string, sshOperationId: string) => {
    setBusy(true);
    setError(false);
    try {
      setMutationReceipt(
        await client.requestMutation(
          integrationId,
          { kind: "SSH_RUN_REGISTERED_OPERATION", sshOperationId },
          csrfToken,
        ),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const decideMutation = async (decision: "APPROVE" | "DENY") => {
    if (!mutationReceipt) return;
    setBusy(true);
    setError(false);
    try {
      setMutationReceipt(
        await client.decideMutation(mutationReceipt.requestId, decision, csrfToken),
      );
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
          <p className="eyebrow">MCP · Automation · Servers · Browser</p>
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
      {mutationReceipt ? (
        <div className="integration-action-result" aria-live="polite">
          <strong>Подтверждение внешней write-команды</strong>
          <span>{mutationReceipt.state}</span>
          {mutationReceipt.state === "PENDING" ? (
            <div>
              <button disabled={busy} onClick={() => void decideMutation("APPROVE")} type="button">
                Подтвердить запуск
              </button>
              <button disabled={busy} onClick={() => void decideMutation("DENY")} type="button">
                Отклонить
              </button>
            </div>
          ) : null}
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
            <option>STEEL</option>
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
            {item.kind === "GITHUB" ? (
              <details>
                <summary>Advanced · workflow dispatch</summary>
                <label>
                  Owner
                  <input
                    value={githubOwner}
                    onChange={(event) => setGithubOwner(event.target.value)}
                  />
                </label>
                <label>
                  Repository
                  <input
                    value={githubRepository}
                    onChange={(event) => setGithubRepository(event.target.value)}
                  />
                </label>
                <label>
                  Workflow
                  <input
                    value={githubWorkflow}
                    onChange={(event) => setGithubWorkflow(event.target.value)}
                  />
                </label>
                <label>
                  Ref
                  <input value={githubRef} onChange={(event) => setGithubRef(event.target.value)} />
                </label>
                <button
                  type="button"
                  disabled={
                    busy ||
                    item.health !== "READY" ||
                    !githubOwner ||
                    !githubRepository ||
                    !githubWorkflow ||
                    !githubRef
                  }
                  onClick={() => void requestGithubDispatch(item.id)}
                >
                  Запросить запуск
                </button>
              </details>
            ) : null}
            {item.kind === "MCP" ? (
              <details>
                <summary>Advanced · разрешённые write-инструменты</summary>
                <label>
                  Название
                  <input
                    value={mcpToolLabel}
                    onChange={(event) => setMcpToolLabel(event.target.value)}
                  />
                </label>
                <label>
                  Точное имя инструмента
                  <input
                    value={mcpToolName}
                    onChange={(event) => setMcpToolName(event.target.value)}
                  />
                </label>
                <label>
                  Фиксированные аргументы JSON
                  <textarea
                    value={mcpFixedArguments}
                    onChange={(event) => setMcpFixedArguments(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || item.health !== "READY" || !mcpToolLabel || !mcpToolName}
                  onClick={() => void registerMcpTool(item.id)}
                >
                  Проверить и зарегистрировать
                </button>
                <ul>
                  {(registry.toolAllowlist ?? [])
                    .filter((tool) => tool.integrationId === item.id)
                    .map((tool) => (
                      <li key={tool.id}>
                        <span>
                          {tool.label} · {tool.toolName}
                        </span>
                        <button
                          type="button"
                          disabled={busy || !tool.isEnabled || item.health !== "READY"}
                          onClick={() => void requestMcpTool(item.id, tool.id)}
                        >
                          Запросить вызов
                        </button>
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
            {item.kind === "SSH" ? (
              <details>
                <summary>Advanced · разрешённые server/deploy операции</summary>
                <p>
                  Fingerprint SHA-256 берётся из доверенного provisioning-канала; AI World отклоняет
                  другой host key.
                </p>
                <label>
                  Операция
                  <select
                    value={sshOperationKind}
                    onChange={(event) =>
                      setSshOperationKind(event.target.value as typeof sshOperationKind)
                    }
                  >
                    <option value="SYSTEMD_RESTART">Restart systemd service</option>
                    <option value="DOCKER_COMPOSE_DEPLOY">Deploy Docker Compose project</option>
                  </select>
                </label>
                <label>
                  Название операции
                  <input
                    value={sshOperationLabel}
                    onChange={(event) => setSshOperationLabel(event.target.value)}
                  />
                </label>
                <label>
                  {sshOperationKind === "SYSTEMD_RESTART" ? "Systemd unit" : "Compose project"}
                  <input value={sshTarget} onChange={(event) => setSshTarget(event.target.value)} />
                </label>
                {sshOperationKind === "DOCKER_COMPOSE_DEPLOY" ? (
                  <label>
                    Абсолютный deployment path
                    <input
                      value={sshWorkingDirectory}
                      onChange={(event) => setSshWorkingDirectory(event.target.value)}
                    />
                  </label>
                ) : null}
                <label>
                  Host key SHA-256
                  <input
                    value={sshHostKeySha256}
                    onChange={(event) => setSshHostKeySha256(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    busy ||
                    item.health !== "READY" ||
                    !sshOperationLabel ||
                    !sshTarget ||
                    !/^SHA256:[A-Za-z0-9+/]{43}$/.test(sshHostKeySha256) ||
                    (sshOperationKind === "DOCKER_COMPOSE_DEPLOY" && !sshWorkingDirectory)
                  }
                  onClick={() => void registerSshOperation(item.id)}
                >
                  Зарегистрировать операцию
                </button>
                <ul>
                  {(registry.sshOperations ?? [])
                    .filter((operation) => operation.integrationId === item.id)
                    .map((operation) => (
                      <li key={operation.id}>
                        <span>
                          {operation.label} · {operation.operationKind}
                        </span>
                        <button
                          type="button"
                          disabled={busy || !operation.isEnabled || item.health !== "READY"}
                          onClick={() => void requestSshOperation(item.id, operation.id)}
                        >
                          Запросить выполнение
                        </button>
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
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
                      STEEL: "STEEL_LIST_SESSIONS",
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
                    : item.kind === "STEEL"
                      ? "Сессии"
                      : "Host info"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
