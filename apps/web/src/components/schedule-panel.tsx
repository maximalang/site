"use client";

import type { AgentSchedule } from "@agent-world/domain";
import type { HubReadModel } from "@agent-world/read-model";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type CreateScheduleInput, createSchedule, loadSchedules } from "../client/schedule-api";

export type ScheduleClient = {
  load(): Promise<AgentSchedule[]>;
  create(input: CreateScheduleInput, csrfToken: string): Promise<AgentSchedule>;
};
const defaultClient: ScheduleClient = {
  load: () => loadSchedules(),
  create: (input, csrfToken) => createSchedule(input, csrfToken),
};
const PRESETS = { DAILY: "0 9 * * *", WEEKDAYS: "0 9 * * 1-5", HOURLY: "0 * * * *" } as const;

export function SchedulePanel({
  hub,
  csrfToken,
  client = defaultClient,
  focusAgentId,
}: {
  hub: HubReadModel;
  csrfToken: string;
  client?: ScheduleClient;
  focusAgentId?: string;
}) {
  const [schedules, setSchedules] = useState<AgentSchedule[]>();
  const [status, setStatus] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");
  const [advanced, setAdvanced] = useState(false);
  const [projectId, setProjectId] = useState(hub.projects[0]?.projectId ?? "");
  const project = hub.projects.find((item) => item.projectId === projectId);
  const agents = useMemo(
    () => hub.agents.filter((agent) => project?.agentIds.includes(agent.agentId)),
    [hub.agents, project],
  );
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [preset, setPreset] = useState<keyof typeof PRESETS>("DAILY");
  const [cronExpression, setCronExpression] = useState<string>(PRESETS.DAILY);
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    if (focusAgentId && agents.some((agent) => agent.agentId === focusAgentId)) {
      setAgentId(focusAgentId);
    } else if (!agents.some((agent) => agent.agentId === agentId)) {
      setAgentId(agents[0]?.agentId ?? "");
    }
  }, [agentId, agents, focusAgentId]);
  useEffect(() => {
    let active = true;
    void client
      .load()
      .then((value) => {
        if (active) setSchedules(value);
      })
      .catch(() => {
        if (active) setStatus("ERROR");
      });
    return () => {
      active = false;
    };
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !agentId) return;
    setStatus("SAVING");
    try {
      const schedule = await client.create(
        {
          id: `schedule_${crypto.randomUUID()}`,
          projectId,
          agentId,
          title,
          cronExpression: advanced ? cronExpression : PRESETS[preset],
          timezone,
          isEnabled,
        } as CreateScheduleInput,
        csrfToken,
      );
      setSchedules((current) => [schedule, ...(current ?? [])]);
      setTitle("");
      setStatus("SAVED");
    } catch {
      setStatus("ERROR");
    }
  }

  return (
    <section className="schedule-panel" aria-labelledby="schedule-panel-title">
      <div className="hub-section-heading">
        <div>
          <p className="eyebrow">Agents · Automation</p>
          <h2 id="schedule-panel-title">Расписания</h2>
        </div>
        <fieldset className="settings-level">
          <legend className="visually-hidden">Уровень настроек расписания</legend>
          <button aria-pressed={!advanced} onClick={() => setAdvanced(false)} type="button">
            Simple
          </button>
          <button aria-pressed={advanced} onClick={() => setAdvanced(true)} type="button">
            Advanced
          </button>
        </fieldset>
      </div>
      <p className="panel-note">
        Срабатывание создаёт Task с обязательным подтверждением. Account и transport выбираются
        позже.
      </p>
      <form className="schedule-form" onSubmit={submit}>
        <label>
          Проект
          <select onChange={(event) => setProjectId(event.target.value)} required value={projectId}>
            <option value="">Выберите проект</option>
            {hub.projects.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select onChange={(event) => setAgentId(event.target.value)} required value={agentId}>
            <option value="">Выберите агента</option>
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Название задачи
          <input
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        {advanced ? (
          <>
            <label>
              Cron (5 полей)
              <input
                onChange={(event) => setCronExpression(event.target.value)}
                pattern="\S+(\s+\S+){4}"
                required
                value={cronExpression}
              />
            </label>
            <label>
              Timezone
              <input
                onChange={(event) => setTimezone(event.target.value)}
                required
                value={timezone}
              />
            </label>
          </>
        ) : (
          <label>
            Период
            <select
              onChange={(event) => setPreset(event.target.value as keyof typeof PRESETS)}
              value={preset}
            >
              <option value="DAILY">Каждый день в 09:00</option>
              <option value="WEEKDAYS">По будням в 09:00</option>
              <option value="HOURLY">Каждый час</option>
            </select>
          </label>
        )}
        <label className="checkbox-field">
          <input
            checked={isEnabled}
            onChange={(event) => setIsEnabled(event.target.checked)}
            type="checkbox"
          />
          Активно
        </label>
        <button className="primary-button" disabled={status === "SAVING" || !agentId} type="submit">
          Создать расписание
        </button>
        <p aria-live="polite" className="form-status">
          {status === "SAVED"
            ? "Расписание создано"
            : status === "ERROR"
              ? "Не удалось загрузить или создать расписание"
              : ""}
        </p>
      </form>
      {!schedules ? (
        <p aria-busy="true" className="hub-empty">
          Загружаем расписания…
        </p>
      ) : schedules.length === 0 ? (
        <p className="hub-empty">Расписаний пока нет.</p>
      ) : (
        <ul className="schedule-list">
          {schedules.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span>
                {item.cronExpression} · {item.timezone} · {item.isEnabled ? "активно" : "выключено"}
              </span>
              <small>
                Следующий запуск:{" "}
                {item.nextFireAt
                  ? new Date(item.nextFireAt).toLocaleString("ru-RU")
                  : "не запланирован"}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
