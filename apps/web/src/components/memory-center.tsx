"use client";

import type {
  MemoryCurationDecisionInput,
  MemoryInbox,
  MemoryNetwork,
  MemoryTimeline,
  RagIngestionRequest,
} from "@agent-world/domain";
import type { HubReadModel } from "@agent-world/read-model";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ingestRagDocument,
  loadMemoryView,
  type MemoryView,
  type MemoryViewModel,
  submitMemoryDecision,
} from "../client/memory-api";
import { MemoryNetworkGraph } from "./memory-network-graph";

export type MemoryCenterClient = {
  load(projectId: string, view: MemoryView): Promise<MemoryViewModel>;
  decide(input: MemoryCurationDecisionInput, csrfToken: string): Promise<unknown>;
  ingest(input: RagIngestionRequest, csrfToken: string): Promise<unknown>;
};

const defaultClient: MemoryCenterClient = {
  load: loadMemoryView,
  decide: submitMemoryDecision,
  ingest: ingestRagDocument,
};

const MEMORY_ACTION_COPY = {
  ACCEPT: "Принято",
  MERGE: "Объединено",
  REJECT: "Отклонено",
} as const;

function decisionId(): string {
  return `memory_decision_${crypto.randomUUID()}`;
}

function MemoryDrawer({
  projectId,
  projectName,
  csrfToken,
  client,
  onClose,
}: {
  projectId: string;
  projectName: string;
  csrfToken: string;
  client: MemoryCenterClient;
  onClose: () => void;
}) {
  const [view, setView] = useState<MemoryView>("INBOX");
  const [model, setModel] = useState<MemoryViewModel>();
  const [network, setNetwork] = useState<MemoryNetwork>();
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pendingProposalId, setPendingProposalId] = useState<string>();
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    closeRef.current?.focus();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void client
      .load(projectId, view)
      .then((next) => {
        if (!active) return;
        setModel(next);
        if (view === "NETWORK") setNetwork(next as MemoryNetwork);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, projectId, view]);

  useEffect(() => {
    if (!advanced || network) return;
    let active = true;
    void client.load(projectId, "NETWORK").then((next) => {
      if (active) setNetwork(next as MemoryNetwork);
    });
    return () => {
      active = false;
    };
  }, [advanced, client, network, projectId]);

  const decide = async (
    proposalId: string,
    action: "ACCEPT" | "MERGE" | "REJECT",
    targetOverride?: string,
  ) => {
    if (pendingProposalId) return;
    const id = decisionId();
    const targetContextItemId = targetOverride ?? mergeTargets[proposalId];
    if (action === "MERGE" && !targetContextItemId) return;
    const input = {
      schemaVersion: 1 as const,
      id,
      proposalId,
      projectId,
      action,
      ...(action === "MERGE" ? { targetContextItemId } : {}),
      idempotencyKey: `memory:ui-${id.slice("memory_decision_".length)}`,
    } as MemoryCurationDecisionInput;
    setPendingProposalId(proposalId);
    setError(false);
    try {
      await client.decide(input, csrfToken);
      setNetwork(undefined);
      const next = await client.load(projectId, view);
      setModel(next);
    } catch {
      setError(true);
    } finally {
      setPendingProposalId(undefined);
    }
  };

  const handleTabs = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const views: MemoryView[] = ["INBOX", "TIMELINE", "NETWORK"];
    const offset = event.key === "ArrowRight" ? 1 : -1;
    setView(views[(views.indexOf(view) + offset + views.length) % views.length] ?? "INBOX");
  };

  const inbox = "proposals" in (model ?? {}) ? (model as MemoryInbox) : undefined;
  const timeline = "entries" in (model ?? {}) ? (model as MemoryTimeline) : undefined;
  const graph = "nodes" in (model ?? {}) ? (model as MemoryNetwork) : undefined;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="memory-center-title"
      className="memory-center-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="drawer-header">
        <div>
          <p className="eyebrow">Каноническая память</p>
          <h2 id="memory-center-title">Memory Center · {projectName}</h2>
        </div>
        <button
          ref={closeRef}
          aria-label="Закрыть Memory Center"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="memory-toolbar">
        <div className="memory-tabs" role="tablist" aria-label="Представление памяти">
          {(["INBOX", "TIMELINE", "NETWORK"] as const).map((item) => (
            <button
              aria-selected={view === item}
              key={item}
              onClick={() => setView(item)}
              onKeyDown={handleTabs}
              role="tab"
              tabIndex={view === item ? 0 : -1}
              type="button"
            >
              {{ INBOX: "Входящие", TIMELINE: "Хронология", NETWORK: "Сеть" }[item]}
            </button>
          ))}
        </div>
        <fieldset className="complexity-toggle">
          <legend className="visually-hidden">Уровень представления</legend>
          <button aria-pressed={!advanced} onClick={() => setAdvanced(false)} type="button">
            Основное
          </button>
          <button aria-pressed={advanced} onClick={() => setAdvanced(true)} type="button">
            Расширенное
          </button>
        </fieldset>
      </div>
      {loading ? (
        <p className="drawer-state" aria-busy="true">
          Загружаем память…
        </p>
      ) : null}
      {error ? (
        <p className="drawer-state" role="alert">
          Memory Center сейчас недоступен. Повторите действие позже.
        </p>
      ) : null}
      {!loading && inbox ? (
        <ul className="memory-inbox-list">
          {inbox.proposals.length === 0 ? (
            <li className="hub-empty">Входящих предложений нет.</li>
          ) : null}
          {inbox.proposals.map((proposal) => {
            const exactCandidate = proposal.curationCandidates[0];
            return (
              <li key={proposal.id}>
                <p>{proposal.content}</p>
                {exactCandidate ? (
                  <p className="panel-note">
                    Найдено точное совпадение с канонической памятью — объединение не создаст дубль.
                  </p>
                ) : null}
                {advanced ? (
                  <dl className="memory-provenance">
                    <div>
                      <dt>Источник</dt>
                      <dd>{proposal.sourceContextItemId}</dd>
                    </div>
                    <div>
                      <dt>Важность</dt>
                      <dd>{proposal.importance}</dd>
                    </div>
                  </dl>
                ) : null}
                <div className="memory-actions">
                  <button
                    disabled={pendingProposalId === proposal.id}
                    onClick={() => void decide(proposal.id, "ACCEPT")}
                    type="button"
                  >
                    Принять
                  </button>
                  <button
                    disabled={pendingProposalId === proposal.id}
                    onClick={() => void decide(proposal.id, "REJECT")}
                    type="button"
                  >
                    Отклонить
                  </button>
                  {exactCandidate ? (
                    <button
                      disabled={pendingProposalId === proposal.id}
                      onClick={() =>
                        void decide(proposal.id, "MERGE", exactCandidate.contextItemId)
                      }
                      type="button"
                    >
                      Объединить с совпадением
                    </button>
                  ) : null}
                  {advanced ? (
                    <>
                      <select
                        aria-label={`Цель объединения для ${proposal.content}`}
                        onChange={(event) =>
                          setMergeTargets((current) => ({
                            ...current,
                            [proposal.id]: event.target.value,
                          }))
                        }
                        value={mergeTargets[proposal.id] ?? ""}
                      >
                        <option value="">Выберите память</option>
                        {network?.nodes.map((node) => (
                          <option key={node.contextItemId} value={node.contextItemId}>
                            {node.content}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={pendingProposalId === proposal.id || !mergeTargets[proposal.id]}
                        onClick={() => void decide(proposal.id, "MERGE")}
                        type="button"
                      >
                        Объединить
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!loading && timeline ? (
        <ol className="memory-timeline">
          {timeline.entries.map((entry) => (
            <li key={entry.decisionId}>
              <span className="status-pill">{MEMORY_ACTION_COPY[entry.action]}</span>
              <p>{entry.content}</p>
              <time dateTime={entry.decidedAt}>
                {new Date(entry.decidedAt).toLocaleString("ru-RU")}
              </time>
              {advanced ? <code>{entry.sourceContextItemId}</code> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {!loading && graph ? <MemoryNetworkGraph advanced={advanced} network={graph} /> : null}
    </dialog>
  );
}

export function MemoryCenter({
  projects,
  csrfToken,
  client = defaultClient,
}: {
  projects: HubReadModel["projects"];
  csrfToken: string;
  client?: MemoryCenterClient;
}) {
  const available = projects.filter((project) => !project.isArchived);
  const [projectId, setProjectId] = useState(available[0]?.projectId ?? "");
  const [open, setOpen] = useState(false);
  const [ragOpen, setRagOpen] = useState(false);
  const [ragTitle, setRagTitle] = useState("");
  const [ragRef, setRagRef] = useState("");
  const [ragContent, setRagContent] = useState("");
  const [ragMimeType, setRagMimeType] = useState<"AUTO" | "text/plain" | "text/markdown">("AUTO");
  const [ragPending, setRagPending] = useState(false);
  const [ragStatus, setRagStatus] = useState<"IDLE" | "SUCCEEDED" | "FAILED">("IDLE");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const project = available.find((item) => item.projectId === projectId);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const ingest = async () => {
    if (!project || ragPending) return;
    setRagPending(true);
    setRagStatus("IDLE");
    try {
      await client.ingest(
        {
          schemaVersion: 1,
          projectId: project.projectId,
          title: ragTitle,
          mimeType:
            ragMimeType === "AUTO"
              ? ragRef.toLowerCase().endsWith(".md")
                ? "text/markdown"
                : "text/plain"
              : ragMimeType,
          content: ragContent,
          source: {
            kind: "UPLOAD",
            ref: ragRef,
            observedAt: new Date().toISOString(),
          },
        },
        csrfToken,
      );
      setRagTitle("");
      setRagRef("");
      setRagContent("");
      setRagStatus("SUCCEEDED");
    } catch {
      setRagStatus("FAILED");
    } finally {
      setRagPending(false);
    }
  };
  return (
    <section className="memory-center-launcher" aria-labelledby="memory-center-launcher-title">
      <div className="hub-section-heading">
        <div>
          <p className="eyebrow">Общий контекст</p>
          <h2 id="memory-center-launcher-title">Memory Center</h2>
        </div>
        <span className="count-badge">{available.length}</span>
      </div>
      <p className="panel-note">
        Входящие, Хронология и Сеть показывают одну каноническую историю памяти.
      </p>
      {available.length === 0 ? (
        <p className="hub-empty">Сначала добавьте активный проект.</p>
      ) : (
        <div className="memory-launch-controls">
          <label htmlFor="memory-project">Проект</label>
          <select
            id="memory-project"
            onChange={(event) => setProjectId(event.target.value)}
            value={projectId}
          >
            {available.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            ref={triggerRef}
            className="primary-button"
            disabled={!project}
            onClick={() => setOpen(true)}
            type="button"
          >
            Открыть Memory Center
          </button>
          <button onClick={() => setRagOpen((value) => !value)} type="button">
            {ragOpen ? "Скрыть RAG-источник" : "Добавить RAG-источник"}
          </button>
        </div>
      )}
      {ragOpen && project ? (
        <form
          className="rag-ingestion-form"
          onSubmit={(event) => {
            event.preventDefault();
            void ingest();
          }}
        >
          <label>
            Название
            <input
              maxLength={500}
              onChange={(event) => setRagTitle(event.target.value)}
              required
              value={ragTitle}
            />
          </label>
          <label>
            Источник / имя файла
            <input
              maxLength={2048}
              onChange={(event) => setRagRef(event.target.value)}
              required
              value={ragRef}
            />
          </label>
          <label>
            Текст для общей базы знаний
            <textarea
              maxLength={5_000_000}
              onChange={(event) => setRagContent(event.target.value)}
              required
              rows={8}
              value={ragContent}
            />
          </label>
          <details>
            <summary>Расширенные настройки</summary>
            <label>
              MIME-тип
              <select
                onChange={(event) => setRagMimeType(event.target.value as typeof ragMimeType)}
                value={ragMimeType}
              >
                <option value="AUTO">Авто</option>
                <option value="text/plain">text/plain</option>
                <option value="text/markdown">text/markdown</option>
              </select>
            </label>
          </details>
          <button className="primary-button" disabled={ragPending} type="submit">
            {ragPending ? "Индексируем…" : "Индексировать"}
          </button>
          {ragStatus === "SUCCEEDED" ? <p role="status">RAG-источник добавлен.</p> : null}
          {ragStatus === "FAILED" ? (
            <p role="alert">Не удалось добавить RAG-источник. Проверьте данные и повторите.</p>
          ) : null}
        </form>
      ) : null}
      {open && project ? (
        <MemoryDrawer
          client={client}
          csrfToken={csrfToken}
          onClose={close}
          projectId={project.projectId}
          projectName={project.name}
        />
      ) : null}
    </section>
  );
}
