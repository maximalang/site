import { RagIngestionReceiptSchema, RagIngestionRequestSchema } from "@agent-world/domain";
import { hasSameOriginHost } from "./request-security";

const MAX_BODY_BYTES = 5_100_000;
const HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

export type RagHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  ingest(input: unknown): Promise<unknown>;
};

class OversizedBodyError extends Error {}

function error(code: string, status: number): Response {
  return Response.json({ error: { code } }, { headers: HEADERS, status });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new TypeError("Invalid content type");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new OversizedBodyError();
  }
  if (!request.body) throw new TypeError("Missing request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new OversizedBodyError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
}

export function createRagRouteHandler(dependencies: RagHttpDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }
    if (request.method !== "POST" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }
    let input: unknown;
    try {
      input = RagIngestionRequestSchema.parse(await readBoundedJson(request));
    } catch (cause) {
      return cause instanceof OversizedBodyError
        ? error("PAYLOAD_TOO_LARGE", 413)
        : error("INVALID_REQUEST", 400);
    }
    try {
      const receipt = RagIngestionReceiptSchema.parse(await dependencies.ingest(input));
      return Response.json(receipt, { headers: HEADERS, status: 201 });
    } catch {
      return error("RAG_INGESTION_UNAVAILABLE", 503);
    }
  };
}
