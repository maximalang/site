"use client";

import type { HubReadModel, ModelRouteCheckResponse } from "@agent-world/read-model";
import { useState } from "react";
import { checkModelRoute } from "../client/model-route-check-api";

export function ModelRouteCheckPanel({
  model,
  csrfToken,
}: {
  model: HubReadModel;
  csrfToken: string;
}) {
  const routes = model.models.flatMap((item) => item.routes).filter((route) => route.isEnabled);
  const [checking, setChecking] = useState<string>();
  const [receipt, setReceipt] = useState<ModelRouteCheckResponse>();
  const [failed, setFailed] = useState(false);
  if (routes.length === 0) return null;
  return (
    <section className="hub-registry-section" aria-labelledby="route-check-heading">
      <div className="hub-section-heading">
        <h2 id="route-check-heading">Проверка ModelRoute</h2>
      </div>
      <ul className="hub-route-list">
        {routes.map((route) => (
          <li key={route.modelRouteId}>
            <span>
              {route.remoteModelId} · {route.surface}
            </span>
            <button
              disabled={!csrfToken || checking !== undefined}
              onClick={() => {
                setChecking(route.modelRouteId);
                setFailed(false);
                void checkModelRoute({ modelRouteId: route.modelRouteId, csrfToken })
                  .then(setReceipt)
                  .catch(() => setFailed(true))
                  .finally(() => setChecking(undefined));
              }}
              type="button"
            >
              {checking === route.modelRouteId ? "Проверяем…" : "Проверить"}
            </button>
          </li>
        ))}
      </ul>
      {receipt ? (
        <p role="status">
          {receipt.mode} · {receipt.providerId} · {receipt.accountId ?? "без Account"} ·{" "}
          {receipt.remoteModelId} · {receipt.usage.totalTokens} tokens
        </p>
      ) : null}
      {failed ? <p role="alert">Маршрут не прошёл проверку.</p> : null}
    </section>
  );
}
