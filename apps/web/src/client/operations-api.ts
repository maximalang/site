import { type OperationsReadModel, OperationsReadModelSchema } from "@agent-world/read-model";

export async function loadOperationsReadModel(): Promise<OperationsReadModel> {
  const response = await fetch("/api/operations", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Operations read model unavailable");
  return OperationsReadModelSchema.parse(await response.json());
}
