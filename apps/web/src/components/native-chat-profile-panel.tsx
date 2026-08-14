"use client";

import type {
  AccountId,
  NativeChatBrowserProfileConfiguration,
  NativeChatBrowserProfileList,
} from "@agent-world/domain";
import type { HubReadModel } from "@agent-world/read-model";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  configureNativeChatProfile,
  loadNativeChatProfiles,
} from "../client/native-chat-profile-api";

export type NativeChatProfileClient = {
  load(): Promise<NativeChatBrowserProfileList>;
  save(
    input: Parameters<typeof configureNativeChatProfile>[0],
    csrfToken: string,
  ): Promise<NativeChatBrowserProfileConfiguration>;
};

const defaultClient: NativeChatProfileClient = {
  load: () => loadNativeChatProfiles(),
  save: (input, csrfToken) => configureNativeChatProfile(input, csrfToken),
};

export function NativeChatProfilePanel({
  hub,
  csrfToken,
  client = defaultClient,
}: {
  hub: HubReadModel;
  csrfToken: string;
  client?: NativeChatProfileClient;
}) {
  const eligibleAccounts = useMemo(
    () =>
      hub.accounts.filter(
        (account) =>
          account.isEnabled &&
          account.authMechanism === "CHATGPT_INTERACTIVE" &&
          account.availableSurfaces.includes("CHAT"),
      ),
    [hub.accounts],
  );
  const [profiles, setProfiles] = useState<NativeChatBrowserProfileConfiguration[]>();
  const [accountId, setAccountId] = useState<AccountId | "">(eligibleAccounts[0]?.accountId ?? "");
  const [launchUrl, setLaunchUrl] = useState("");
  const [profileRef, setProfileRef] = useState("plus-1");
  const [isEnabled, setIsEnabled] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [status, setStatus] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");

  useEffect(() => {
    let active = true;
    void client
      .load()
      .then((result) => {
        if (active) setProfiles(result.profiles);
      })
      .catch(() => {
        if (active) setStatus("ERROR");
      });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!accountId || !profiles) return;
    const existing = profiles.find((profile) => profile.accountId === accountId);
    const index = eligibleAccounts.findIndex((account) => account.accountId === accountId);
    setLaunchUrl(existing?.launchUrl ?? "");
    setProfileRef(existing?.profileRef ?? `plus-${index + 1}`);
    setIsEnabled(existing?.isEnabled ?? true);
  }, [accountId, eligibleAccounts, profiles]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId) return;
    setStatus("SAVING");
    try {
      const configured = await client.save(
        { schemaVersion: 1, accountId, profileRef, launchUrl, isEnabled },
        csrfToken,
      );
      setProfiles((current) =>
        [...(current ?? []).filter((profile) => profile.accountId !== accountId), configured].sort(
          (left, right) => left.accountId.localeCompare(right.accountId),
        ),
      );
      setStatus("SAVED");
    } catch {
      setStatus("ERROR");
    }
  }

  return (
    <section className="native-chat-profile-panel" aria-labelledby="native-chat-profile-title">
      <div className="hub-section-heading">
        <div>
          <p className="eyebrow">Accounts · Chat transport</p>
          <h2 id="native-chat-profile-title">Native Plus Chat</h2>
        </div>
        <fieldset className="settings-level">
          <legend className="visually-hidden">Уровень настроек</legend>
          <button aria-pressed={!advanced} onClick={() => setAdvanced(false)} type="button">
            Simple
          </button>
          <button aria-pressed={advanced} onClick={() => setAdvanced(true)} type="button">
            Advanced
          </button>
        </fieldset>
      </div>
      <p className="panel-note">
        Launcher отправляет только run_id. Результат возвращается через AI World MCP, не через DOM.
      </p>
      {eligibleAccounts.length === 0 ? (
        <p className="hub-empty">Добавьте ChatGPT Interactive Account с surface CHAT.</p>
      ) : (
        <form className="native-chat-profile-form" method="post" onSubmit={submit}>
          <label htmlFor="native-chat-account">ChatGPT Account</label>
          <select
            id="native-chat-account"
            name="accountId"
            onChange={(event) => {
              setAccountId(event.target.value as AccountId);
              setStatus("IDLE");
            }}
            value={accountId}
          >
            {eligibleAccounts.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.label} · {account.subscription ?? "Chat"}
              </option>
            ))}
          </select>
          <label htmlFor="native-chat-launch-url">AI World App URL</label>
          <p className="field-hint" id="native-chat-launch-url-hint">
            Точный chatgpt.com URL подключённого AI World App или Custom GPT.
          </p>
          <input
            aria-describedby="native-chat-launch-url-hint"
            id="native-chat-launch-url"
            name="launchUrl"
            onChange={(event) => setLaunchUrl(event.target.value)}
            pattern="https://chatgpt[.]com/[^?#]+"
            required
            type="url"
            value={launchUrl}
          />
          {advanced ? (
            <fieldset>
              <legend>Launcher routing</legend>
              <label htmlFor="native-chat-profile-ref">Browser profile alias</label>
              <input
                id="native-chat-profile-ref"
                name="profileRef"
                onChange={(event) => setProfileRef(event.target.value)}
                pattern="[a-z0-9]+([._-][a-z0-9]+)*"
                required
                value={profileRef}
              />
              <label className="checkbox-field" htmlFor="native-chat-profile-enabled">
                <input
                  checked={isEnabled}
                  id="native-chat-profile-enabled"
                  name="isEnabled"
                  onChange={(event) => setIsEnabled(event.target.checked)}
                  type="checkbox"
                />
                Launcher enabled
              </label>
            </fieldset>
          ) : null}
          <button className="primary-button" disabled={status === "SAVING"} type="submit">
            Сохранить подключение
          </button>
          <p aria-live="polite" className="form-status">
            {status === "SAVED"
              ? "Подключение сохранено"
              : status === "ERROR"
                ? "Не удалось сохранить подключение"
                : ""}
          </p>
        </form>
      )}
    </section>
  );
}
