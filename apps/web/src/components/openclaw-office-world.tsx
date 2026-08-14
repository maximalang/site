"use client";

import type { WorldView } from "@agent-world/read-model";
import {
  createOfficePresentation,
  DEFAULT_OFFICE_SKIN,
  type OfficePresentationAgent,
  type OfficeVisualStatus,
} from "../world/openclaw-office-adapter";

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

function avatarColors(seed: string) {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const palettes = [
    ["#ffb86b", "#7c3aed"],
    ["#75e6c6", "#245b78"],
    ["#f5a3c7", "#713e63"],
    ["#f2d56b", "#6a5420"],
  ] as const;
  return palettes[hash % palettes.length] ?? palettes[0];
}

function AgentPawn({ agent }: { agent: OfficePresentationAgent }) {
  const [body, trim] = avatarColors(agent.avatarSeed);
  return (
    <svg aria-hidden="true" className="office-pawn" viewBox="0 0 64 78">
      <ellipse className="office-pawn-shadow" cx="32" cy="70" rx="22" ry="6" />
      <path d="M13 62c0-16 8-25 19-25s19 9 19 25v7H13z" fill={body} stroke={trim} />
      <circle cx="32" cy="25" r="16" fill="#f4cba8" stroke={trim} />
      <path d="M17 24c1-13 8-19 16-19 10 0 16 7 16 18-5-5-10-7-16-7-7 0-11 3-16 8z" fill={trim} />
      <circle cx="27" cy="26" r="1.6" fill="#17211f" />
      <circle cx="38" cy="26" r="1.6" fill="#17211f" />
      <path d="M28 32c3 2 6 2 9 0" fill="none" stroke="#8b4d49" strokeLinecap="round" />
    </svg>
  );
}

export function OpenClawOfficeWorld({
  world,
  selectedAgentId,
  onSelectAgent,
  onOpenConversation,
}: OpenClawOfficeWorldProps) {
  const office = createOfficePresentation(world, DEFAULT_OFFICE_SKIN);
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
          <path d="M380 188h330v40H380zM380 365h330v40H380z" />
          <circle cx="875" cy="350" r="58" />
          <path d="M1015 180h98v56h-98zM1015 470h98v56h-98z" />
          <path
            className="office-plant"
            d="M170 165c-44-26-55 35-12 45-19 43 48 48 48 5 46 2 48-57 5-54-2-39-50-37-41 4z"
          />
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
    </div>
  );
}
