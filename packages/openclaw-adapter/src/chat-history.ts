import { OpaqueExternalIdSchema, TimestampSchema } from "@agent-world/domain";
import * as z from "zod";

const MAX_HISTORY_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 32_000;

const MetadataSchema = z.object({
  id: OpaqueExternalIdSchema,
  recordTimestampMs: z.number().int().nonnegative(),
});

const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(MAX_MESSAGE_CHARS),
});

const AssistantHistoryMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.union([z.string().max(MAX_MESSAGE_CHARS), z.array(z.unknown()).max(1_000)]),
  __openclaw: MetadataSchema,
});

const ChatHistoryResultSchema = z.object({
  messages: z.array(z.unknown()).max(MAX_HISTORY_MESSAGES),
});

export type OpenClawReceivedMessage = {
  externalMessageId: string;
  content: string;
  createdAt: string;
};

function visibleText(content: string | unknown[]): string | undefined {
  if (typeof content === "string") {
    const normalized = content.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  const parts = content.flatMap((block) => {
    const parsed = TextBlockSchema.safeParse(block);
    return parsed.success && parsed.data.text.trim() ? [parsed.data.text.trim()] : [];
  });
  const normalized = parts.join("\n\n").trim();
  return normalized.length > 0 && normalized.length <= MAX_MESSAGE_CHARS ? normalized : undefined;
}

export function normalizeOpenClawChatHistory(input: unknown): OpenClawReceivedMessage[] {
  const result = ChatHistoryResultSchema.parse(input);
  const messages = new Map<string, OpenClawReceivedMessage>();
  for (const candidate of result.messages) {
    const parsed = AssistantHistoryMessageSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const content = visibleText(parsed.data.content);
    if (!content) continue;
    const message: OpenClawReceivedMessage = {
      externalMessageId: parsed.data.__openclaw.id,
      content,
      createdAt: TimestampSchema.parse(
        new Date(parsed.data.__openclaw.recordTimestampMs).toISOString(),
      ),
    };
    const existing = messages.get(message.externalMessageId);
    if (
      existing &&
      (existing.content !== message.content || existing.createdAt !== message.createdAt)
    ) {
      throw new Error("OpenClaw history reused a message identity with conflicting content");
    }
    messages.set(message.externalMessageId, message);
  }
  return [...messages.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.externalMessageId.localeCompare(right.externalMessageId),
  );
}
