import { ProviderCredentialWriteResponseSchema } from "@agent-world/read-model";

export async function writeProviderCredential(input: {
  accountId: string;
  apiKey: string;
  csrfToken: string;
}): Promise<void> {
  const response = await fetch("/api/hub/provider-credentials", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "X-Agent-World-CSRF": input.csrfToken,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      commandId: `provider-key-${crypto.randomUUID()}`,
      accountId: input.accountId,
      apiKey: input.apiKey,
    }),
  });
  if (
    !response.ok ||
    !ProviderCredentialWriteResponseSchema.safeParse(await response.json()).success
  ) {
    throw new Error("Provider credential write failed");
  }
}
