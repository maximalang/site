"use client";

import type {
  AgentConversationList,
  ConversationReadModel,
  ConversationSendResponse,
} from "@agent-world/read-model";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  loadAgentConversations,
  loadConversation,
  sendConversationMessage,
} from "../client/conversation-api";

type AgentIdentity = { agentId: string; displayName: string };

export type ConversationClient = {
  loadIndex(agentId: string): Promise<AgentConversationList>;
  loadConversation(conversationId: string): Promise<ConversationReadModel>;
  send(input: {
    conversationId: string;
    agentId: string;
    messageId: string;
    content: string;
    csrfToken: string;
  }): Promise<ConversationSendResponse>;
};

export const defaultConversationClient: ConversationClient = {
  loadIndex: (agentId) => loadAgentConversations(agentId),
  loadConversation: (conversationId) => loadConversation(conversationId),
  send: (input) => sendConversationMessage(input),
};

function newMessageId(): string {
  return `message_${crypto.randomUUID()}`;
}

function displayTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function sendFailureCopy(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "NO_ACTIVE_SESSION") {
      return "У агента нет активной runtime-сессии. Сообщение сохранено для точного повтора.";
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return "Этот идентификатор уже относится к другому сообщению. Измените текст и отправьте снова.";
    }
  }
  return "Сообщение не доставлено. Текст сохранён — можно повторить отправку.";
}

export function ConversationDrawer({
  agent,
  csrfToken,
  onClose,
  client = defaultConversationClient,
}: {
  agent: AgentIdentity;
  csrfToken: string;
  onClose: () => void;
  client?: ConversationClient;
}) {
  const [index, setIndex] = useState<AgentConversationList>();
  const [conversationId, setConversationId] = useState<string>();
  const [conversation, setConversation] = useState<ConversationReadModel>();
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [retry, setRetry] = useState<{ messageId: string; content: string }>();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    void refreshNonce;
    let active = true;
    setLoadingIndex(true);
    setLoadError(false);
    setIndex(undefined);
    setConversationId(undefined);
    setConversation(undefined);
    void client
      .loadIndex(agent.agentId)
      .then((next) => {
        if (!active) return;
        setIndex(next);
        setConversationId(next.conversations[0]?.conversationId);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoadingIndex(false);
      });
    return () => {
      active = false;
    };
  }, [agent.agentId, client, refreshNonce]);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    setLoadingConversation(true);
    setLoadError(false);
    setConversation(undefined);
    void client
      .loadConversation(conversationId)
      .then((next) => {
        if (active) setConversation(next);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoadingConversation(false);
      });
    return () => {
      active = false;
    };
  }, [client, conversationId]);

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
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
    const content = draft;
    if (!conversationId || content.trim().length === 0 || content.length > 32_000 || sending)
      return;
    const attempt = retry?.content === content ? retry : { messageId: newMessageId(), content };
    setRetry(attempt);
    setSending(true);
    setSendError(undefined);
    try {
      const result = await client.send({
        conversationId,
        agentId: agent.agentId,
        messageId: attempt.messageId,
        content,
        csrfToken,
      });
      setConversation((current) =>
        current
          ? {
              ...current,
              messages: current.messages.some(
                (message) => message.messageId === result.message.messageId,
              )
                ? current.messages
                : [...current.messages, result.message],
            }
          : current,
      );
      setDraft("");
      setRetry(undefined);
    } catch (error) {
      setSendError(sendFailureCopy(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="drawer-backdrop">
      <section
        ref={panelRef}
        aria-labelledby="conversation-title"
        aria-modal="true"
        className="conversation-drawer"
        onKeyDown={handleKeys}
        role="dialog"
      >
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Conversation</p>
            <h2 id="conversation-title">{agent.displayName}</h2>
          </div>
          <div className="drawer-actions">
            <button
              className="text-button"
              disabled={loadingIndex || loadingConversation}
              onClick={() => setRefreshNonce((value) => value + 1)}
              type="button"
            >
              Обновить
            </button>
            <button
              ref={closeRef}
              aria-label="Закрыть диалог"
              className="icon-button"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        {index && index.conversations.length > 1 ? (
          <label className="conversation-picker">
            <span>Диалог</span>
            <select
              value={conversationId}
              onChange={(event) => setConversationId(event.target.value)}
            >
              {index.conversations.map((item) => (
                <option key={item.conversationId} value={item.conversationId}>
                  {item.title ?? displayTime(item.createdAt)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="message-timeline" aria-live="polite">
          {loadingIndex || loadingConversation ? (
            <p className="drawer-state" aria-busy="true">
              Загружаем диалог…
            </p>
          ) : null}
          {loadError ? (
            <div className="drawer-state" role="alert">
              <p>Диалог сейчас недоступен.</p>
              <button
                className="text-button"
                onClick={() => setRefreshNonce((value) => value + 1)}
                type="button"
              >
                Повторить
              </button>
            </div>
          ) : null}
          {!loadingIndex && !loadError && index?.conversations.length === 0 ? (
            <p className="drawer-state">У этого агента пока нет канонического диалога.</p>
          ) : null}
          {conversation && conversation.messages.length === 0 ? (
            <p className="drawer-state">Сообщений пока нет. Начните рабочий диалог.</p>
          ) : null}
          {conversation?.messages.map((message) => (
            <article className="message" data-author={message.author} key={message.messageId}>
              <div className="message-meta">
                <strong>{message.author === "OWNER" ? "Вы" : agent.displayName}</strong>
                <span>{displayTime(message.createdAt)}</span>
              </div>
              <p>{message.content}</p>
              <small>{message.delivery}</small>
            </article>
          ))}
        </div>

        {conversation ? (
          <form className="composer" onSubmit={submit}>
            <label htmlFor="conversation-message">Сообщение</label>
            <textarea
              id="conversation-message"
              maxLength={32_000}
              onChange={(event) => {
                setDraft(event.target.value);
                if (retry && retry.content !== event.target.value) setRetry(undefined);
                setSendError(undefined);
              }}
              placeholder="Напишите задачу или уточнение…"
              rows={4}
              value={draft}
            />
            {sendError ? (
              <p className="composer-error" role="alert">
                {sendError}
              </p>
            ) : null}
            <div className="composer-footer">
              <span>{draft.length.toLocaleString("ru-RU")} / 32 000</span>
              <button
                className="primary-button"
                disabled={sending || draft.trim().length === 0}
                type="submit"
              >
                {sending ? "Отправляем…" : retry ? "Повторить отправку" : "Отправить"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
