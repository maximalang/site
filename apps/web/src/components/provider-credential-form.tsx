"use client";

import type { HubReadModel } from "@agent-world/read-model";
import { type FormEvent, useState } from "react";
import { writeProviderCredential } from "../client/provider-credential-api";

export function ProviderCredentialForm({
  model,
  csrfToken,
}: {
  model: HubReadModel;
  csrfToken: string;
}) {
  const accounts = model.accounts.filter(
    (account) => account.authMechanism === "API_KEY" && account.isEnabled,
  );
  const [accountId, setAccountId] = useState(accounts[0]?.accountId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [state, setState] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accountId || !apiKey || !csrfToken) return;
    setState("SAVING");
    try {
      await writeProviderCredential({ accountId, apiKey, csrfToken });
      setApiKey("");
      setState("SAVED");
    } catch {
      setState("ERROR");
    }
  }

  if (accounts.length === 0) return null;
  return (
    <section className="hub-registry-section" aria-labelledby="provider-key-heading">
      <div className="hub-section-heading">
        <h2 id="provider-key-heading">API-ключ провайдера</h2>
      </div>
      <form className="provider-key-form" onSubmit={submit}>
        <label>
          Аккаунт
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          API-ключ
          <input
            autoComplete="off"
            maxLength={16_384}
            onChange={(event) => {
              setApiKey(event.target.value);
              setState("IDLE");
            }}
            required
            type="password"
            value={apiKey}
          />
        </label>
        <button
          className="primary-button"
          disabled={state === "SAVING" || !csrfToken}
          type="submit"
        >
          {state === "SAVING" ? "Сохраняем…" : "Сохранить ключ"}
        </button>
        {state === "SAVED" ? (
          <p role="status">Ключ сохранён. Значение больше не отображается.</p>
        ) : null}
        {state === "ERROR" ? <p role="alert">Не удалось сохранить ключ.</p> : null}
      </form>
    </section>
  );
}
