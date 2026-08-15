"use client";
import {
  type HubCommandRequest,
  HubCommandRequestSchema,
  type HubReadModel,
} from "@agent-world/read-model";
import { useState } from "react";
import { executeHubCommand } from "../client/hub-command-api";

export function ChatGptAccountPanel({
  providers,
  accounts,
  csrfToken,
  client = { execute: executeHubCommand },
  onCreated,
}: {
  providers: HubReadModel["providers"];
  accounts: HubReadModel["accounts"];
  csrfToken: string;
  client?: { execute(command: HubCommandRequest, csrfToken: string): Promise<unknown> };
  onCreated?: (accountId: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [subscription, setSubscription] = useState("Plus");
  const [codex, setCodex] = useState(false);
  const [state, setState] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");
  const submit = async () => {
    setState("SAVING");
    try {
      let providerId = providers.find(
        (provider) => provider.kind === "OPENAI" && provider.category === "CONSUMER_ACCOUNT",
      )?.providerId;
      if (!providerId) {
        const uuid = crypto.randomUUID();
        const providerCommand = HubCommandRequestSchema.parse({
          schemaVersion: 1,
          commandId: `hub_command_${crypto.randomUUID()}`,
          kind: "PROVIDER_CREATE",
          providerId: `provider_${uuid}`,
          slug: `chatgpt-consumer-${uuid.slice(0, 8)}`,
          displayName: "ChatGPT consumer accounts",
          providerKind: "OPENAI",
          category: "CONSUMER_ACCOUNT",
        });
        await client.execute(providerCommand, csrfToken);
        if (providerCommand.kind !== "PROVIDER_CREATE") throw new Error("Provider command drift");
        providerId = providerCommand.providerId;
      }
      const accountId = `account_${crypto.randomUUID()}`;
      await client.execute(
        HubCommandRequestSchema.parse({
          schemaVersion: 1,
          commandId: `hub_command_${crypto.randomUUID()}`,
          kind: "ACCOUNT_CREATE",
          accountId,
          providerId,
          label,
          authMechanism: "CHATGPT_INTERACTIVE",
          subscription,
          availableSurfaces: codex ? ["CHAT", "CODEX"] : ["CHAT"],
        }),
        csrfToken,
      );
      setLabel("");
      setState("SAVED");
      onCreated?.(accountId);
    } catch {
      setState("ERROR");
    }
  };
  return (
    <section className="chatgpt-account-panel" aria-labelledby="chatgpt-account-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Account ≠ Agent</p>
          <h2 id="chatgpt-account-title">ChatGPT Accounts</h2>
        </div>
        <span className="count-badge">
          {accounts.filter((account) => account.authMechanism === "CHATGPT_INTERACTIVE").length}
        </span>
      </div>
      <p>
        Добавление регистрирует Account; browser login выполняется отдельно и только после него
        health станет активным.
      </p>
      {state === "SAVED" ? <p role="status">Account добавлен; требуется вход</p> : null}
      {state === "ERROR" ? <p role="alert">Account не добавлен.</p> : null}
      <div className="chatgpt-account-form">
        <label>
          Название аккаунта
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label>
          Подписка
          <select value={subscription} onChange={(event) => setSubscription(event.target.value)}>
            <option>Plus</option>
            <option>Pro</option>
            <option>Free</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={codex}
            onChange={(event) => setCodex(event.target.checked)}
          />
          Разрешить Codex surface
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={!csrfToken || !label || state === "SAVING"}
          onClick={() => void submit()}
        >
          {state === "SAVING" ? "Добавляем…" : "Добавить ChatGPT Account"}
        </button>
      </div>
    </section>
  );
}
