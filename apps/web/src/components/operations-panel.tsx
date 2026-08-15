"use client";

import type { OperationsReadModel } from "@agent-world/read-model";
import { useEffect, useState } from "react";
import { loadOperationsReadModel } from "../client/operations-api";

export function OperationsPanel({
  load = loadOperationsReadModel,
}: {
  load?: () => Promise<OperationsReadModel>;
}) {
  const [model, setModel] = useState<OperationsReadModel>();
  const [error, setError] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    let active = true;
    void load()
      .then((value) => active && setModel(value))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [load]);
  if (error)
    return (
      <section className="operations-panel" role="alert">
        <h2>Operations недоступен</h2>
        <p>Непроверенные показатели не отображаются.</p>
      </section>
    );
  if (!model)
    return (
      <section aria-busy="true" aria-label="Загрузка Operations" className="operations-panel">
        <h2>Operations</h2>
      </section>
    );
  const { observatory, actionGraph } = model;
  return (
    <section aria-labelledby="operations-title" className="operations-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Action Graph · Observatory</p>
          <h2 id="operations-title">Operations</h2>
        </div>
        <button
          aria-pressed={advanced}
          className="text-button"
          onClick={() => setAdvanced((value) => !value)}
          type="button"
        >
          {advanced ? "Simple" : "Advanced"}
        </button>
      </div>
      <dl className="operations-metrics">
        <div>
          <dt>Runs</dt>
          <dd>
            {observatory.runs.completed} / {observatory.runs.total}
          </dd>
        </div>
        <div>
          <dt>Tokens in / out</dt>
          <dd>
            {observatory.tokens.input.toLocaleString("ru")} /{" "}
            {observatory.tokens.output.toLocaleString("ru")}
          </dd>
        </div>
        <div>
          <dt>Context pressure</dt>
          <dd>{Math.round(observatory.context.pressure * 100)}%</dd>
        </div>
        <div>
          <dt>Денежная стоимость</dt>
          <dd>Нет достоверных данных</dd>
        </div>
      </dl>
      <ol aria-label="Action Graph" className="action-graph-list">
        {actionGraph.nodes.map((node) => (
          <li key={`${node.kind}:${node.id}`}>
            <span>{node.kind}</span>
            <strong>{node.label}</strong>
            <small>{node.status}</small>
            {node.kind === "RUN" && node.resultSummary ? <p>{node.resultSummary}</p> : null}
          </li>
        ))}
      </ol>
      {advanced ? (
        <div className="operations-advanced">
          <p>Cached input: {observatory.tokens.cachedInput.toLocaleString("ru")}</p>
          <p>
            Context: {observatory.context.estimatedTokens.toLocaleString("ru")} /{" "}
            {observatory.context.budgetTokens.toLocaleString("ru")}
          </p>
          <p>Edges: {actionGraph.edges.length}</p>
          <ul>
            {observatory.routeSignals.map((signal) => (
              <li key={signal.routeId}>
                {signal.routeId}: limits {Math.round(signal.remainingLimits * 100)}%, cost
                efficiency {Math.round(signal.costEfficiency * 100)}%,{" "}
                {signal.isFresh ? "fresh" : "stale"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
