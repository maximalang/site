"use client";
import type { HubCommandRequest } from "@agent-world/read-model";
import { useState } from "react";
import { executeHubCommand } from "../client/hub-command-api";

type AgentCommand = Extract<HubCommandRequest, { kind: "AGENT_CREATE" }>;
export function AgentProvisioningPanel({
  projects,
  skills,
  tools,
  csrfToken,
  client = { execute: executeHubCommand },
}: {
  projects: Array<{ projectId: string; name: string }>;
  skills: Array<{ skillId: string; displayName: string }>;
  tools: Array<{ toolId: string; displayName: string }>;
  csrfToken: string;
  client?: { execute(command: AgentCommand, csrfToken: string): Promise<unknown> };
}) {
  const [projectId, setProjectId] = useState(projects[0]?.projectId ?? "");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"AUTO" | "CHAT" | "WORK" | "CODEX" | "API" | "LOCAL">("AUTO");
  const [context, setContext] = useState<"AUTO" | "LEAN" | "BALANCED" | "RICH">("AUTO");
  const [budget, setBudget] = useState<"AUTO" | "ECONOMY" | "BALANCED" | "QUALITY">("AUTO");
  const [state, setState] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");
  const toggle = (values: string[], value: string, checked: boolean) =>
    [...new Set(checked ? [...values, value] : values.filter((id) => id !== value))].sort();
  const submit = async () => {
    setState("SAVING");
    try {
      const uuid = crypto.randomUUID();
      await client.execute(
        {
          schemaVersion: 1,
          commandId: `hub_command_${crypto.randomUUID()}`,
          kind: "AGENT_CREATE",
          agentId: `agent_${uuid}`,
          slug,
          displayName,
          role,
          instructions,
          provisioning: {
            templateId: `agent_template_${uuid}`,
            templateVersion: 1,
            projectId,
            skillIds,
            toolIds,
            preferences: { mode, context, budget },
          },
        } as AgentCommand,
        csrfToken,
      );
      setState("SAVED");
    } catch {
      setState("ERROR");
    }
  };
  return (
    <section className="agent-provisioning-panel" aria-labelledby="agent-provisioning-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Template → Instance</p>
          <h2 id="agent-provisioning-title">Новый Agent</h2>
        </div>
      </div>
      {state === "SAVED" ? <p role="status">Agent Instance создан</p> : null}
      {state === "ERROR" ? <p role="alert">Agent не создан.</p> : null}
      {projects.length === 0 ? (
        <p>Сначала создайте Project.</p>
      ) : (
        <div className="agent-provisioning-form">
          <label>
            Project
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((item) => (
                <option key={item.projectId} value={item.projectId}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Имя Agent
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            Slug
            <input value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>
          <label>
            Роль
            <input value={role} onChange={(event) => setRole(event.target.value)} />
          </label>
          <label>
            Instructions
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <fieldset>
            <legend>Skills</legend>
            {skills.map((item) => (
              <label key={item.skillId}>
                <input
                  type="checkbox"
                  checked={skillIds.includes(item.skillId)}
                  onChange={(event) =>
                    setSkillIds(toggle(skillIds, item.skillId, event.target.checked))
                  }
                />
                {item.displayName}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Tools</legend>
            {tools.map((item) => (
              <label key={item.toolId}>
                <input
                  type="checkbox"
                  checked={toolIds.includes(item.toolId)}
                  onChange={(event) =>
                    setToolIds(toggle(toolIds, item.toolId, event.target.checked))
                  }
                />
                {item.displayName}
              </label>
            ))}
          </fieldset>
          <details>
            <summary>Advanced</summary>
            <label>
              Memory context
              <select
                value={context}
                onChange={(event) => setContext(event.target.value as typeof context)}
              >
                {["AUTO", "LEAN", "BALANCED", "RICH"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Token budget
              <select
                value={budget}
                onChange={(event) => setBudget(event.target.value as typeof budget)}
              >
                {["AUTO", "ECONOMY", "BALANCED", "QUALITY"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Preferred execution
              <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                {["AUTO", "CHAT", "WORK", "CODEX", "API", "LOCAL"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </details>
          <button
            className="primary-button"
            type="button"
            disabled={
              state === "SAVING" || !csrfToken || !displayName || !slug || !role || !instructions
            }
            onClick={() => void submit()}
          >
            {state === "SAVING" ? "Создаём…" : "Создать Agent"}
          </button>
        </div>
      )}
    </section>
  );
}
