"use client";

import {
  type HubCommandRequest,
  HubCommandRequestSchema,
  type HubReadModel,
} from "@agent-world/read-model";
import { useMemo, useState } from "react";
import { executeHubCommand } from "../client/hub-command-api";

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const NEW_ACCOUNT = "__new__";

function validOpenRouterModelId(value: string): boolean {
  const modelId = value.trim();
  return (
    modelId.length > 2 &&
    modelId.length <= 512 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(modelId)
  );
}

export function OpenRouterProviderPanel({
  hub,
  csrfToken,
  client = { execute: executeHubCommand },
  onCreated,
}: {
  hub: HubReadModel;
  csrfToken: string;
  client?: { execute(command: HubCommandRequest, csrfToken: string): Promise<unknown> };
  onCreated?: (result: { accountId: string; modelRouteId: string }) => void;
}) {
  const provider = hub.providers.find(
    (candidate) => candidate.kind === "OPENROUTER" && candidate.category === "LLM_API",
  );
  const accounts = useMemo(
    () =>
      provider
        ? hub.accounts.filter(
            (account) =>
              account.providerId === provider.providerId && account.authMechanism === "API_KEY",
          )
        : [],
    [hub.accounts, provider],
  );
  const enabledModels = hub.models.filter((model) => model.isEnabled);
  const [canonicalModelId, setCanonicalModelId] = useState(enabledModels[0]?.modelId ?? "");
  const [accountSelection, setAccountSelection] = useState(accounts[0]?.accountId ?? NEW_ACCOUNT);
  const [accountLabel, setAccountLabel] = useState("OpenRouter API");
  const [remoteModelId, setRemoteModelId] = useState("");
  const [state, setState] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");

  const selectedModel = hub.models.find((model) => model.modelId === canonicalModelId);
  const modelIdIsValid = validOpenRouterModelId(remoteModelId);
  const creatingAccount = accountSelection === NEW_ACCOUNT;

  const submit = async () => {
    if (!selectedModel || !modelIdIsValid) return;
    setState("SAVING");
    try {
      let providerId = provider?.providerId;
      if (!providerId) {
        const providerCommand = HubCommandRequestSchema.parse({
          schemaVersion: 1,
          commandId: `hub_command_${crypto.randomUUID()}`,
          kind: "PROVIDER_CREATE",
          providerId: `provider_${crypto.randomUUID()}`,
          slug: "openrouter",
          displayName: "OpenRouter",
          providerKind: "OPENROUTER",
          category: "LLM_API",
          baseUrl: OPENROUTER_API_BASE,
        });
        await client.execute(providerCommand, csrfToken);
        if (providerCommand.kind !== "PROVIDER_CREATE") throw new Error("Provider command drift");
        providerId = providerCommand.providerId;
      }

      let accountId = creatingAccount ? undefined : accountSelection;
      if (!accountId) {
        const accountCommand = HubCommandRequestSchema.parse({
          schemaVersion: 1,
          commandId: `hub_command_${crypto.randomUUID()}`,
          kind: "ACCOUNT_CREATE",
          accountId: `account_${crypto.randomUUID()}`,
          providerId,
          label: accountLabel.trim(),
          authMechanism: "API_KEY",
          availableSurfaces: ["API"],
        });
        await client.execute(accountCommand, csrfToken);
        if (accountCommand.kind !== "ACCOUNT_CREATE") throw new Error("Account command drift");
        accountId = accountCommand.accountId;
      }

      const modelRouteId = `model_route_${crypto.randomUUID()}`;
      await client.execute(
        HubCommandRequestSchema.parse({
          schemaVersion: 1,
          commandId: `hub_command_${crypto.randomUUID()}`,
          kind: "MODEL_ROUTE_CREATE",
          modelRouteId,
          canonicalModelId: selectedModel.modelId,
          providerId,
          accountId,
          surface: "API",
          remoteModelId: remoteModelId.trim(),
          availability: "AVAILABLE",
          contextWindowTokens: selectedModel.capabilities.contextWindowTokens,
          reasoningEfforts: selectedModel.capabilities.reasoning ? ["LOW", "MEDIUM", "HIGH"] : [],
          supportedModalities: selectedModel.capabilities.modalities,
          supportedToolIds: [],
        }),
        csrfToken,
      );
      setRemoteModelId("");
      setState("SAVED");
      onCreated?.({ accountId, modelRouteId });
    } catch {
      setState("ERROR");
    }
  };

  return (
    <section aria-labelledby="openrouter-provider-title" className="hub-control-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LLM API</p>
          <h2 id="openrouter-provider-title">OpenRouter</h2>
        </div>
        <span className="count-badge">{accounts.length}</span>
      </div>
      <p>
        Создайте канонический API account и ModelRoute. API key сохраняется отдельно в «Маршрутах»
        через защищённую форму credentials и после сохранения не показывается.
      </p>
      {state === "SAVED" ? (
        <p role="status">OpenRouter route создан; сохраните API key и выполните route check.</p>
      ) : null}
      {state === "ERROR" ? <p role="alert">Не удалось создать OpenRouter route.</p> : null}
      {enabledModels.length === 0 ? (
        <p>Сначала нужен хотя бы один включённый Canonical Model.</p>
      ) : (
        <div className="hub-control-form">
          <label>
            Canonical Model
            <select
              value={canonicalModelId}
              onChange={(event) => setCanonicalModelId(event.target.value)}
            >
              {enabledModels.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          {accounts.length > 0 ? (
            <label>
              API account
              <select
                value={accountSelection}
                onChange={(event) => setAccountSelection(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.label} · {account.health}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>Новый API account</option>
              </select>
            </label>
          ) : null}
          {creatingAccount ? (
            <label>
              Название API account
              <input
                value={accountLabel}
                onChange={(event) => setAccountLabel(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            OpenRouter model ID
            <input
              autoCapitalize="none"
              autoComplete="off"
              placeholder="anthropic/model-name"
              spellCheck={false}
              value={remoteModelId}
              onChange={(event) => setRemoteModelId(event.target.value)}
            />
          </label>
          {remoteModelId && !modelIdIsValid ? (
            <p role="alert">Используйте OpenRouter slug в формате provider/model без пробелов.</p>
          ) : null}
          <p>API origin фиксирован: {OPENROUTER_API_BASE}</p>
          <button
            className="primary-button"
            disabled={
              state === "SAVING" ||
              !csrfToken ||
              !selectedModel ||
              !modelIdIsValid ||
              (creatingAccount && !accountLabel.trim())
            }
            onClick={() => void submit()}
            type="button"
          >
            {state === "SAVING" ? "Создаём…" : "Создать OpenRouter route"}
          </button>
        </div>
      )}
    </section>
  );
}
