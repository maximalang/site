import {
  type ModelRouteCheckResponse,
  ModelRouteCheckResponseSchema,
} from "@agent-world/read-model";

export async function checkModelRoute(input: {
  modelRouteId: string;
  csrfToken: string;
}): Promise<ModelRouteCheckResponse> {
  const response = await fetch("/api/hub/model-routes/check", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "X-Agent-World-CSRF": input.csrfToken },
    body: JSON.stringify({ schemaVersion: 1, modelRouteId: input.modelRouteId }),
  });
  if (!response.ok) throw new Error("Model route check failed");
  return ModelRouteCheckResponseSchema.parse(await response.json());
}
