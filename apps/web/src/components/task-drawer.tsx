"use client";

import type {
  AgentConversationList,
  ApprovalDecisionResponse,
  TaskAssignmentResponse,
} from "@agent-world/read-model";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { decideApproval } from "../client/approval-api";
import { loadAgentConversations } from "../client/conversation-api";
import { assignTask } from "../client/task-api";

type AgentIdentity = { agentId: string; displayName: string };
type DecisionMode = "DENY" | "REVOKE";
type DecisionRetry = { decisionId: string; signature: string };

export type TaskClient = {
  loadIndex(agentId: string): Promise<AgentConversationList>;
  assign(input: {
    taskId: string;
    conversationId: string;
    agentId: string;
    title: string;
    description?: string;
    csrfToken: string;
  }): Promise<TaskAssignmentResponse>;
  decide?(input: {
    taskId: string;
    decisionId: string;
    decision: "APPROVE" | "DENY" | "REVOKE";
    reason?: string;
    csrfToken: string;
  }): Promise<ApprovalDecisionResponse>;
};

const defaultTaskClient: TaskClient = {
  loadIndex: (agentId) => loadAgentConversations(agentId),
  assign: (input) => assignTask(input),
  decide: (input) =>
    input.decision === "APPROVE"
      ? decideApproval({ ...input, decision: "APPROVE" })
      : decideApproval({ ...input, decision: input.decision, reason: input.reason ?? "" }),
};

const DESCRIPTION_PREVIEW_LENGTH = 240;

function newTaskId() {
  return `task_${crypto.randomUUID()}`;
}

export function TaskDrawer({
  agent,
  csrfToken,
  onAssigned,
  onDecided,
  onClose,
  client = defaultTaskClient,
}: {
  agent: AgentIdentity;
  csrfToken: string;
  onAssigned: (result: TaskAssignmentResponse) => void;
  onDecided?: (result: ApprovalDecisionResponse) => void;
  onClose: () => void;
  client?: TaskClient;
}) {
  const [index, setIndex] = useState<AgentConversationList>();
  const [conversationId, setConversationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [assigned, setAssigned] = useState<TaskAssignmentResponse>();
  const [decision, setDecision] = useState<ApprovalDecisionResponse>();
  const [decisionMode, setDecisionMode] = useState<DecisionMode>();
  const [decisionReason, setDecisionReason] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState(false);
  const [decisionRetry, setDecisionRetry] = useState<DecisionRetry>();
  const [negativeDecisionRetry, setNegativeDecisionRetry] = useState<DecisionRetry>();
  const [retry, setRetry] = useState<{ taskId: string; signature: string }>();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const taskConversations =
    index?.conversations.filter((conversation) => conversation.taskAssignmentAvailable) ?? [];
  const assignedConversation = taskConversations.find(
    (conversation) => conversation.conversationId === conversationId,
  );
  const cleanDescription = description.trim();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (decisionMode) reasonRef.current?.focus();
  }, [decisionMode]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    void client
      .loadIndex(agent.agentId)
      .then((next) => {
        if (!active) return;
        setIndex(next);
        setConversationId(
          next.conversations.find((conversation) => conversation.taskAssignmentAvailable)
            ?.conversationId ?? "",
        );
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agent.agentId, client]);

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const nextDescription = description.trim();
    if (!conversationId || !cleanTitle || submitting) return;
    const signature = JSON.stringify([conversationId, cleanTitle, nextDescription]);
    const attempt = retry?.signature === signature ? retry : { taskId: newTaskId(), signature };
    setRetry(attempt);
    setSubmitting(true);
    setSubmitError(false);
    try {
      const result = await client.assign({
        taskId: attempt.taskId,
        conversationId,
        agentId: agent.agentId,
        title: cleanTitle,
        ...(nextDescription ? { description: nextDescription } : {}),
        csrfToken,
      });
      setAssigned(result);
      setRetry(undefined);
      onAssigned(result);
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const submitDecision = async (kind: "APPROVE" | "DENY" | "REVOKE") => {
    if (!assigned || !client.decide || deciding) return;
    const reason = decisionReason.trim();
    if (kind !== "APPROVE" && !reason) return;
    const signature = JSON.stringify([assigned.task.id, kind, reason]);
    const previousAttempt = kind === "APPROVE" ? decisionRetry : negativeDecisionRetry;
    const attempt =
      previousAttempt?.signature === signature
        ? previousAttempt
        : { decisionId: crypto.randomUUID(), signature };
    if (kind === "APPROVE") setDecisionRetry(attempt);
    else setNegativeDecisionRetry(attempt);
    setDeciding(true);
    setDecisionError(false);
    try {
      const result = await client.decide({
        taskId: assigned.task.id,
        decisionId: attempt.decisionId,
        decision: kind,
        ...(kind === "APPROVE" ? {} : { reason }),
        csrfToken,
      });
      setDecision(result);
      if (kind === "APPROVE") {
        setDecisionRetry(result.dispatch === "PENDING" ? attempt : undefined);
      } else {
        setNegativeDecisionRetry(undefined);
      }
      setDecisionMode(undefined);
      setDecisionReason("");
      onDecided?.(result);
    } catch {
      setDecisionError(true);
    } finally {
      setDeciding(false);
    }
  };

  const openDecisionMode = (mode: DecisionMode) => {
    setDecisionMode(mode);
    setDecisionReason("");
    setDecisionError(false);
  };

  const cancelDecisionMode = () => {
    const returnFocus = decisionMode === "REVOKE" ? revokeRef : rejectRef;
    setDecisionMode(undefined);
    setDecisionReason("");
    setDecisionError(false);
    window.requestAnimationFrame(() => returnFocus.current?.focus());
  };

  const decisionStatus = decision
    ? decision.approval.type === "APPROVED"
      ? decision.dispatch === "PENDING"
        ? "Задача подтверждена и ожидает доступный runtime."
        : "Задача подтверждена и передана в runtime."
      : decision.approval.type === "DENIED"
        ? "Выполнение задачи отклонено."
        : decision.approval.type === "REVOKED"
          ? "Разрешение на выполнение отозвано."
          : "Задача назначена. Статус: требует подтверждения; запуск не выполнен."
    : "Задача назначена. Статус: требует подтверждения; запуск не выполнен.";
  const canRevoke = decision?.approval.type === "APPROVED" && decision.dispatch === "PENDING";

  return (
    <div className="drawer-backdrop">
      <section
        ref={panelRef}
        aria-labelledby="task-title"
        aria-modal="true"
        className="conversation-drawer task-drawer"
        onKeyDown={handleKeys}
        role="dialog"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Task assignment</p>
            <h2 id="task-title">Задача для {agent.displayName}</h2>
          </div>
          <button
            ref={closeRef}
            aria-label="Закрыть назначение задачи"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        {loading ? (
          <p className="drawer-state" aria-busy="true">
            Загружаем рабочие диалоги…
          </p>
        ) : null}
        {loadError ? (
          <p className="drawer-state" role="alert">
            Диалоги сейчас недоступны.
          </p>
        ) : null}
        {!loading && !loadError && index && taskConversations.length === 0 ? (
          <p className="drawer-state">Сначала создайте активный канонический диалог для агента.</p>
        ) : null}
        {!loading && index && taskConversations.length > 0 && !assigned ? (
          <form className="composer task-form" onSubmit={submit}>
            <label htmlFor="task-conversation">Рабочий диалог</label>
            <select
              id="task-conversation"
              disabled={submitting}
              onChange={(event) => {
                setConversationId(event.target.value);
                setRetry(undefined);
                setSubmitError(false);
              }}
              value={conversationId}
            >
              {taskConversations.map((conversation) => (
                <option key={conversation.conversationId} value={conversation.conversationId}>
                  {conversation.title ?? conversation.conversationId}
                </option>
              ))}
            </select>
            <label htmlFor="task-name">Название</label>
            <input
              id="task-name"
              disabled={submitting}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                setRetry(undefined);
                setSubmitError(false);
              }}
              required
              value={title}
            />
            <label htmlFor="task-description">Описание</label>
            <textarea
              id="task-description"
              disabled={submitting}
              maxLength={20_000}
              onChange={(event) => {
                setDescription(event.target.value);
                setRetry(undefined);
                setSubmitError(false);
              }}
              rows={7}
              value={description}
            />
            <p className="task-policy-note">
              Назначение сохранится отдельно от чата. Выполнение не начнётся без явного
              подтверждения.
            </p>
            {submitError ? (
              <p className="composer-error" role="alert">
                Задача не назначена. Проверьте активную сессию и повторите без изменения полей.
              </p>
            ) : null}
            <div className="composer-footer">
              <span>{title.length} / 200</span>
              <button
                className="primary-button"
                disabled={submitting || !conversationId || !title.trim()}
                type="submit"
              >
                {submitting ? "Назначаем…" : retry ? "Повторить назначение" : "Назначить задачу"}
              </button>
            </div>
          </form>
        ) : null}
        {!loading && index && taskConversations.length > 0 && assigned ? (
          <div className="task-assigned-surface">
            <section
              className="task-assignment-summary"
              aria-labelledby="task-assignment-summary-title"
            >
              <p className="eyebrow">Task</p>
              <h3 id="task-assignment-summary-title">Задача назначена</h3>
              <dl>
                <div>
                  <dt>Диалог</dt>
                  <dd>{assignedConversation?.title ?? conversationId}</dd>
                </div>
                <div>
                  <dt>Задача</dt>
                  <dd>{title.trim()}</dd>
                </div>
                {cleanDescription ? (
                  <div>
                    <dt>Описание</dt>
                    <dd>
                      {cleanDescription.length > DESCRIPTION_PREVIEW_LENGTH ? (
                        <details className="task-summary-description">
                          <summary>
                            {cleanDescription.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…
                          </summary>
                          <p>{cleanDescription}</p>
                        </details>
                      ) : (
                        cleanDescription
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <div className="task-decision-panel">
              <p className="task-success" role="status">
                {decisionStatus}
              </p>
              {decision?.execution ? (
                <dl className="task-execution-provenance" aria-label="Execution provenance">
                  <div>
                    <dt>Account</dt>
                    <dd>{decision.execution.accountId ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{decision.execution.remoteModelId ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>{decision.execution.mode}</dd>
                  </div>
                  <div>
                    <dt>Adapter</dt>
                    <dd>{decision.execution.adapterKind}</dd>
                  </div>
                </dl>
              ) : null}

              {decisionMode ? (
                <div className="task-decision-reason-mode">
                  <label htmlFor="task-decision-reason">
                    Причина {decisionMode === "REVOKE" ? "отзыва" : "отклонения"}
                  </label>
                  <textarea
                    ref={reasonRef}
                    id="task-decision-reason"
                    disabled={deciding}
                    maxLength={1_000}
                    onChange={(event) => {
                      setDecisionReason(event.target.value);
                      setDecisionError(false);
                    }}
                    rows={3}
                    value={decisionReason}
                  />
                  <div className="task-decision-actions">
                    <button
                      className="secondary-button"
                      disabled={deciding}
                      onClick={cancelDecisionMode}
                      type="button"
                    >
                      Отмена
                    </button>
                    <button
                      className="primary-button"
                      disabled={deciding || !decisionReason.trim()}
                      onClick={() => void submitDecision(decisionMode)}
                      type="button"
                    >
                      {deciding
                        ? "Сохраняем…"
                        : decisionMode === "REVOKE"
                          ? "Подтвердить отзыв"
                          : "Подтвердить отклонение"}
                    </button>
                  </div>
                </div>
              ) : !decision ? (
                <div className="task-decision-actions">
                  <button
                    className="primary-button"
                    disabled={deciding}
                    onClick={() => void submitDecision("APPROVE")}
                    type="button"
                  >
                    {deciding ? "Сохраняем…" : "Подтвердить и запустить"}
                  </button>
                  <button
                    ref={rejectRef}
                    className="secondary-button"
                    disabled={deciding}
                    onClick={() => openDecisionMode("DENY")}
                    type="button"
                  >
                    Отклонить
                  </button>
                </div>
              ) : canRevoke ? (
                <div className="task-decision-actions">
                  <button
                    className="primary-button"
                    disabled={deciding}
                    onClick={() => void submitDecision("APPROVE")}
                    type="button"
                  >
                    {deciding ? "Отправляем…" : "Повторить отправку"}
                  </button>
                  <button
                    ref={revokeRef}
                    className="secondary-button"
                    disabled={deciding}
                    onClick={() => openDecisionMode("REVOKE")}
                    type="button"
                  >
                    Отозвать разрешение
                  </button>
                </div>
              ) : null}

              {decisionError ? (
                <p className="composer-error" role="alert">
                  Решение не сохранено. Повторите без изменения полей.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
