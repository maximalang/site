import {
  type MemoryCurationDecision,
  MemoryCurationDecisionInputSchema,
  MemoryInboxSchema,
  MemoryNetworkSchema,
  MemoryTimelineSchema,
  ProjectIdSchema,
} from "@agent-world/domain";
import { MemoryCurationStoreError } from "@agent-world/postgres-store";
import * as z from "zod";
import { hasSameOriginHost } from "./request-security";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const ViewSchema = z.enum(["INBOX", "TIMELINE", "NETWORK"]);

export type MemoryHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  inbox(projectId: string, limit: number): Promise<unknown>;
  timeline(projectId: string, limit: number): Promise<unknown>;
  network(projectId: string, limit: number): Promise<unknown>;
  decide(input: MemoryCurationDecision): Promise<unknown>;
  now?: () => Date;
};

function error(code: string, status: number): Response {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("Invalid content type");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 5_000) throw new Error("Oversized request");
  return JSON.parse(text) as unknown;
}

export function createMemoryRouteHandler(dependencies: MemoryHttpDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }

    if (request.method === "GET") {
      let projectId: string;
      let view: z.infer<typeof ViewSchema>;
      let limit: number;
      try {
        const url = new URL(request.url);
        if (
          [...url.searchParams.keys()].some((key) => !["projectId", "view", "limit"].includes(key))
        ) {
          return error("INVALID_REQUEST", 400);
        }
        projectId = ProjectIdSchema.parse(url.searchParams.get("projectId"));
        view = ViewSchema.parse(url.searchParams.get("view"));
        const rawLimit = url.searchParams.get("limit");
        limit = rawLimit === null ? 100 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500)
          return error("INVALID_REQUEST", 400);
      } catch {
        return error("INVALID_REQUEST", 400);
      }
      try {
        const value =
          view === "INBOX"
            ? MemoryInboxSchema.parse(await dependencies.inbox(projectId, limit))
            : view === "TIMELINE"
              ? MemoryTimelineSchema.parse(await dependencies.timeline(projectId, limit))
              : MemoryNetworkSchema.parse(await dependencies.network(projectId, limit));
        return Response.json(value, { headers: RESPONSE_HEADERS, status: 200 });
      } catch {
        return error("MEMORY_UNAVAILABLE", 503);
      }
    }

    if (request.method !== "POST" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }
    try {
      const input = MemoryCurationDecisionInputSchema.parse(await readBody(request));
      const decidedAt = (dependencies.now ?? (() => new Date()))().toISOString();
      const receipt = await dependencies.decide({ ...input, decidedAt });
      return Response.json(receipt, { headers: RESPONSE_HEADERS, status: 200 });
    } catch (cause) {
      if (cause instanceof MemoryCurationStoreError) {
        const status =
          cause.code === "PROPOSAL_NOT_FOUND" || cause.code === "TARGET_NOT_FOUND" ? 422 : 409;
        return error(cause.code, status);
      }
      return error("INVALID_REQUEST", 400);
    }
  };
}
