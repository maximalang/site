import {
  type MemoryCurationDecisionInput,
  type MemoryInbox,
  MemoryInboxSchema,
  type MemoryNetwork,
  MemoryNetworkSchema,
  type MemoryTimeline,
  MemoryTimelineSchema,
  type RagIngestionReceipt,
  RagIngestionReceiptSchema,
  type RagIngestionRequest,
} from "@agent-world/domain";

export type MemoryView = "INBOX" | "TIMELINE" | "NETWORK";
export type MemoryViewModel = MemoryInbox | MemoryTimeline | MemoryNetwork;
type FetchMemory = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadMemoryView(
  projectId: string,
  view: MemoryView,
  fetcher: FetchMemory = fetch,
): Promise<MemoryViewModel> {
  const query = new URLSearchParams({ projectId, view });
  const response = await fetcher(`/api/memory?${query}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Memory Center is unavailable");
  const body = await response.json();
  const parsed =
    view === "INBOX"
      ? MemoryInboxSchema.safeParse(body)
      : view === "TIMELINE"
        ? MemoryTimelineSchema.safeParse(body)
        : MemoryNetworkSchema.safeParse(body);
  if (!parsed.success) throw new Error("Invalid Memory Center response");
  return parsed.data;
}

export async function submitMemoryDecision(
  input: MemoryCurationDecisionInput,
  csrfToken: string,
  fetcher: FetchMemory = fetch,
): Promise<unknown> {
  const response = await fetcher("/api/memory", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Memory decision was not committed");
  return response.json();
}

export async function ingestRagDocument(
  input: RagIngestionRequest,
  csrfToken: string,
  fetcher: FetchMemory = fetch,
): Promise<RagIngestionReceipt> {
  const response = await fetcher("/api/rag", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("RAG ingestion failed");
  return RagIngestionReceiptSchema.parse(await response.json());
}
