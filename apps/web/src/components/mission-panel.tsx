"use client";

import { type Mission, MissionSchema } from "@agent-world/domain";
import { useState } from "react";
import { createMission as createMissionRequest } from "../client/mission-api";

export type MissionClient = { create(input: Mission, csrfToken: string): Promise<void> };

export function MissionPanel({
  projects,
  csrfToken,
  client = { create: createMissionRequest },
}: {
  projects: Array<{ projectId: string; name: string }>;
  csrfToken: string;
  client?: MissionClient;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.projectId ?? "");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [criterion, setCriterion] = useState("");
  const [verification, setVerification] = useState<
    "TEST" | "ARTIFACT" | "METRIC" | "OWNER_CONFIRMATION"
  >("TEST");
  const [policy, setPolicy] = useState<"REVIEW_EACH_TASK" | "AUTO_SAFE_HANDOFF">(
    "REVIEW_EACH_TASK",
  );
  const [state, setState] = useState<"IDLE" | "SAVING" | "SAVED" | "ERROR">("IDLE");

  const submit = async () => {
    setState("SAVING");
    try {
      const uuid = crypto.randomUUID();
      const now = new Date().toISOString();
      await client.create(
        MissionSchema.parse({
          schemaVersion: 1,
          id: `mission_${uuid}`,
          projectId,
          title,
          goal,
          status: "ACTIVE",
          executionPolicy: policy,
          successCriteria: [
            {
              id: `mission_criterion_${crypto.randomUUID()}`,
              statement: criterion,
              verification,
              status: "PENDING",
              evidenceRefs: [],
            },
          ],
          createdAt: now,
          updatedAt: now,
        }),
        csrfToken,
      );
      setTitle("");
      setGoal("");
      setCriterion("");
      setState("SAVED");
    } catch {
      setState("ERROR");
    }
  };

  return (
    <section className="mission-panel" aria-labelledby="mission-panel-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Goal orchestration</p>
          <h2 id="mission-panel-title">Новая Mission</h2>
        </div>
      </div>
      {state === "SAVED" ? <p role="status">Mission создана</p> : null}
      {state === "ERROR" ? <p role="alert">Mission не создана.</p> : null}
      {projects.length === 0 ? (
        <p>Сначала создайте Project.</p>
      ) : (
        <div className="mission-form">
          <label>
            Project
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Название Mission
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Цель
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} />
          </label>
          <label>
            Критерий успеха
            <textarea value={criterion} onChange={(event) => setCriterion(event.target.value)} />
          </label>
          <label>
            Проверка
            <select
              value={verification}
              onChange={(event) => setVerification(event.target.value as typeof verification)}
            >
              <option value="TEST">Test</option>
              <option value="ARTIFACT">Artifact</option>
              <option value="METRIC">Metric</option>
              <option value="OWNER_CONFIRMATION">Owner confirmation</option>
            </select>
          </label>
          <details>
            <summary>Advanced</summary>
            <label>
              Политика выполнения
              <select
                value={policy}
                onChange={(event) => setPolicy(event.target.value as typeof policy)}
              >
                <option value="REVIEW_EACH_TASK">Review each task</option>
                <option value="AUTO_SAFE_HANDOFF">Auto safe handoff</option>
              </select>
            </label>
          </details>
          <button
            className="primary-button"
            type="button"
            disabled={state === "SAVING" || !csrfToken || !title || !goal || !criterion}
            onClick={() => void submit()}
          >
            {state === "SAVING" ? "Создаём…" : "Создать Mission"}
          </button>
        </div>
      )}
    </section>
  );
}
