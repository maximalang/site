"use client";

import type { WorldView } from "@agent-world/read-model";
import {
  createOfficePresentation,
  DEFAULT_OFFICE_SKIN,
  type OfficePresentationAgent,
  type OfficeVisualStatus,
} from "../world/openclaw-office-adapter";
import {
  OfficeDesk,
  OfficeMeetingTable,
  OfficePawn,
  OfficePlant,
  OfficeSofa,
} from "./openclaw-office-primitives";

type AgentId = WorldView["agents"][number]["core"]["agentId"];
type OpenClawOfficeWorldProps = {
  world: WorldView;
  selectedAgentId: AgentId | undefined;
  onSelectAgent: (id: AgentId) => void;
  onOpenConversation: (id: AgentId) => void;
};

const STATUS_GLYPH: Record<OfficeVisualStatus, string> = {
  IDLE: "·",
  QUEUED: "…",
  WORKING: "›",
  REVIEWING: "?",
  BLOCKED: "!",
  ERROR: "×",
  OFFLINE: "○",
};

function AgentPawn({ agent }: { agent: OfficePresentationAgent }) {
  return (
    <OfficePawn
      reviewing={agent.visualStatus === "REVIEWING"}
      seed={agent.avatarSeed}
      working={agent.visualStatus === "WORKING"}
    />
  );
}

export function OpenClawOfficeWorld({
  world,
  selectedAgentId,
  onSelectAgent,
  onOpenConversation,
}: OpenClawOfficeWorldProps) {
  const office = createOfficePresentation(world, DEFAULT_OFFICE_SKIN);
  const activeDeskCount = Math.min(
    4,
    office.agents.filter((agent) => agent.visualStatus === "WORKING").length,
  );
  return (
    <div
      className="openclaw-office-world office-world"
      style={{ aspectRatio: `${office.width} / ${office.height}` }}
      data-skin={office.skinId}
    >
      <svg
        aria-label="Открытый офис AI World с четырьмя рабочими зонами"
        className="office-floor"
        role="img"
        viewBox={`0 0 ${office.width} ${office.height}`}
      >
        <title>OpenClaw Office — проекция реального состояния AI World</title>
        <defs>
          <pattern id="office-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M28 0H0V28" fill="none" stroke="currentColor" strokeOpacity=".08" />
          </pattern>
        </defs>
        <rect className="office-floor-base" width={office.width} height={office.height} rx="22" />
        <rect className="office-floor-grid" width={office.width} height={office.height} rx="22" />
        {office.zones.map((zone) => (
          <g data-testid="office-zone" key={zone.id}>
            <rect
              className={`office-zone office-zone-${zone.id.toLowerCase()}`}
              height={zone.height}
              rx="18"
              width={zone.width}
              x={zone.x}
              y={zone.y}
            />
            <text className="office-zone-label" x={zone.x + 18} y={zone.y + 30}>
              {zone.label}
            </text>
          </g>
        ))}
        <g className="office-furniture">
          <OfficeDesk active={activeDeskCount > 0} x={455} y={150} />
          <OfficeDesk active={activeDeskCount > 1} x={645} y={150} />
          <OfficeDesk active={activeDeskCount > 2} x={455} y={430} />
          <OfficeDesk active={activeDeskCount > 3} x={645} y={430} />
          <OfficeMeetingTable x={875} y={350} />
          <OfficeSofa x={183} y={230} />
          <OfficeSofa x={183} y={430} />
          <OfficePlant x={95} y={145} />
          <OfficePlant x={275} y={570} />
        </g>
        <g className="office-handoff-layer">
          {office.handoffs.map((handoff) => (
            <path
              className="office-handoff-path"
              d={`M${handoff.fromX} ${handoff.fromY} Q${(handoff.fromX + handoff.toX) / 2} ${Math.min(handoff.fromY, handoff.toY) - 70} ${handoff.toX} ${handoff.toY}`}
              data-handoff-cue={handoff.id}
              key={handoff.id}
              pathLength="1"
            />
          ))}
        </g>
      </svg>
      {office.agents.map((agent) => (
        <button
          aria-label={`${agent.displayName}: ${agent.statusLabel}. Открыть карточку агента`}
          className={`office-agent office-agent-${agent.visualStatus.toLowerCase()}${selectedAgentId === agent.agentId ? " is-selected" : ""}`}
          data-action-cue={agent.actionCue}
          key={agent.agentId}
          onClick={() => onSelectAgent(agent.agentId)}
          onDoubleClick={() => onOpenConversation(agent.agentId)}
          style={{
            left: `${(agent.x / office.width) * 100}%`,
            top: `${(agent.y / office.height) * 100}%`,
          }}
          type="button"
        >
          <AgentPawn agent={agent} />
          <span className="office-agent-name">{agent.displayName}</span>
          <span aria-hidden="true" className="office-agent-status">
            {STATUS_GLYPH[agent.visualStatus]}
          </span>
        </button>
      ))}
      {office.handoffs.length > 0 ? (
        <ol aria-label="Последние передачи работы" className="office-handoff-feed">
          {office.handoffs.map((handoff) => (
            <li key={handoff.id}>
              <span>
                {handoff.fromDisplayName} → {handoff.toDisplayName}
              </span>
              <time dateTime={handoff.occurredAt}>
                {new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(
                  new Date(handoff.occurredAt),
                )}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
