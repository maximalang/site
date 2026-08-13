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
  const [decisionReason, setDecisionReason] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState(false);
  const [decisionRetry, setDecisionRetry] = useState<{
    decisionId: string;
    signature: string;
  }>();
  const [retry, setRetry] = useState<{ taskId: string; signature: string }>();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const taskConversations =
    index?.conversations.filter((conversation) => conversation.taskAssignmentAvailable) ?? [];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

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
    const cleanDescription = description.trim();
    if (!conversationId || !cleanTitle || submitting) return;
    const signature = JSON.stringify([conversationId, cleanTitle, cleanDescription]);
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
        ...(cleanDescription ? { description: cleanDescription } : {}),
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
    const attempt =
      decisionRetry?.signature === signature
        ? decisionRetry
        : { decisionId: crypto.randomUUID(), signature };
    setDecisionRetry(attempt);
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
      setDecisionRetry(kind === "APPROVE" && result.dispatch === "PENDING" ? attempt : undefined);
      onDecided?.(result);
    } catch {
      setDecisionError(true);
    } finally {
      setDeciding(false);
    }
  };

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
        {!loading && index && taskConversations.length > 0 ? (
          <form className="composer task-form" onSubmit={submit}>
            <label htmlFor="task-conversation">Рабочий диалог</label>
            <select
              id="task-conversation"
              disabled={submitting || Boolean(assigned)}
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
              disabled={submitting || Boolean(assigned)}
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
              disabled={submitting || Boolean(assigned)}
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
            {assigned ? (
              <div className="task-decision-panel">
                <p className="task-success" role="status">
                  {decision?.approval.type === "APPROVED"
                    ? decision.dispatch === "PENDING"
                      ? "Задача подтверждена и ожидает доступный runtime."
                      : "Задача подтверждена и передана в runtime."
                    : decision?.approval.type === "DENIED"
                      ? "Выполнение задачи отклонено."
                      : "Задача назначена. Статус: требует подтверждения; запуск не выполнен."}
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
                {!decision || decision.approval.type === "APPROVED" ? (
                  <>
                    <label htmlFor="task-decision-reason">
                      Причина {decision?.dispatch === "PENDING" ? "отзыва" : "отклонения"}
                    </label>
                    <textarea
                      id="task-decision-reason"
                      disabled={deciding}
                      maxLength={1_000}
                      onChange={(event) => {
                        setDecisionReason(event.target.value);
                        setDecisionRetry(undefined);
                        setDecisionError(false);
                      }}
                      rows={3}
                      value={decisionReason}
                    />
                    <div className="task-decision-actions">
                      {!decision ? (
                        <button
                          className="primary-button"
                          disabled={deciding}
                          onClick={() => void submitDecision("APPROVE")}
                          type="button"
                        >
                          {deciding ? "Сохраняем…" : "Подтвердить и запустить"}
                        </button>
                      ) : null}
                      {decision?.dispatch === "PENDING" ? (
                        <button
                          className="primary-button"
                          disabled={deciding}
                          onClick={() => void submitDecision("APPROVE")}
                          type="button"
                        >
                          {deciding ? "Отправляем…" : "Повторить отправку"}
                        </button>
                      ) : null}
                      <button
                        className="secondary-button"
                        disabled={deciding || !decisionReason.trim()}
                        onClick={() =>
                          void submitDecision(decision?.dispatch === "PENDING" ? "REVOKE" : "DENY")
                        }
                        type="button"
                      >
                        {decision?.dispatch === "PENDING" ? "Отозвать разрешение" : "Отклонить"}
                      </button>
                    </div>
                  </>
                ) : null}
                {decisionError ? (
                  <p className="composer-error" role="alert">
                    Решение не сохранено. Повторите без изменения полей.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="composer-footer">
              <span>{title.length} / 200</span>
              <button
                className="primary-button"
                disabled={submitting || Boolean(assigned) || !conversationId || !title.trim()}
                type="submit"
              >
                {submitting ? "Назначаем…" : retry ? "Повторить назначение" : "Назначить задачу"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
