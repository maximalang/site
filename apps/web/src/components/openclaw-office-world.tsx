"use client";

import type { WorldView } from "@agent-world/read-model";
import { useEffect, useMemo, useState } from "react";
import {
  createOfficePresentation,
  DEFAULT_OFFICE_SKIN,
  getOfficeSkin,
  OFFICE_SKINS,
  type OfficePresentationAgent,
  type OfficeVisualStatus,
  resolveOfficeSkin,
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
  systemSkinId?: string;
  projectSkinId?: string;
};

const USER_SKIN_PREFERENCE_KEY = "agent-world.office-skin.v1";

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
  systemSkinId = DEFAULT_OFFICE_SKIN.id,
  projectSkinId,
}: OpenClawOfficeWorldProps) {
  const configuredSkin = useMemo(
    () =>
      resolveOfficeSkin({
        ...(projectSkinId === undefined ? {} : { projectSkinId }),
        systemSkinId,
      }),
    [projectSkinId, systemSkinId],
  );
  const [skinId, setSkinId] = useState(configuredSkin.id);

  useEffect(() => {
    const stored = window.localStorage.getItem(USER_SKIN_PREFERENCE_KEY);
    setSkinId(
      resolveOfficeSkin({
        userPreferenceId: stored,
        ...(projectSkinId === undefined ? {} : { projectSkinId }),
        systemSkinId,
      }).id,
    );
  }, [projectSkinId, systemSkinId]);

  const skin = getOfficeSkin(skinId) ?? configuredSkin;
  const hasSkinOverride = skin.id !== configuredSkin.id;
  const office = createOfficePresentation(world, skin);
  const activeDeskCount = Math.min(
    4,
    office.agents.filter((agent) => agent.visualStatus === "WORKING").length,
  );

  const selectSkin = (nextSkinId: string) => {
    const next = getOfficeSkin(nextSkinId);
    if (!next) return;
    if (next.id === configuredSkin.id) {
      window.localStorage.removeItem(USER_SKIN_PREFERENCE_KEY);
    } else {
      window.localStorage.setItem(USER_SKIN_PREFERENCE_KEY, next.id);
    }
    setSkinId(next.id);
  };

  const useConfiguredSkin = () => {
    window.localStorage.removeItem(USER_SKIN_PREFERENCE_KEY);
    setSkinId(configuredSkin.id);
  };

  return (
    <section aria-label="Карта World">
      <div className="memory-launch-controls world-skin-controls">
        <label htmlFor="world-skin">Вид карты</label>
        <select
          id="world-skin"
          onChange={(event) => selectSkin(event.target.value)}
          value={skin.id}
        >
          {OFFICE_SKINS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {hasSkinOverride ? (
          <button className="world-skin-reset" onClick={useConfiguredSkin} type="button">
            Сбросить
          </button>
        ) : null}
      </div>
      <div
        className="openclaw-office-world office-world"
        style={{ aspectRatio: `${office.width} / ${office.height}` }}
        data-skin={office.skinId}
        data-theme={skin.theme}
      >
        <svg
          aria-label={`${skin.label}: карта World с четырьмя рабочими зонами`}
          className="office-floor"
          role="img"
          style={{ color: skin.palette.grid }}
          viewBox={`0 0 ${office.width} ${office.height}`}
        >
          <title>{skin.label} — визуальная проекция состояния World</title>
          <defs>
            <pattern id="office-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M28 0H0V28" fill="none" stroke="currentColor" strokeOpacity=".08" />
            </pattern>
          </defs>
          <rect
            className="office-floor-base"
            height={office.height}
            rx="22"
            style={{ fill: skin.palette.floor }}
            width={office.width}
          />
          <rect className="office-floor-grid" width={office.width} height={office.height} rx="22" />
          {office.zones.map((zone) => (
            <g data-testid="office-zone" key={zone.id}>
              <rect
                className={`office-zone office-zone-${zone.id.toLowerCase()}`}
                height={zone.height}
                rx="18"
                style={{ fill: skin.palette.zones[zone.id] }}
                width={zone.width}
                x={zone.x}
                y={zone.y}
              />
              <text className="office-zone-label" x={zone.x + 18} y={zone.y + 30}>
                {zone.label}
              </text>
            </g>
          ))}
          {skin.theme === "OPENCLAW_OFFICE" ? (
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
          ) : null}
          <g className="office-handoff-layer" style={{ color: skin.palette.accent }}>
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
    </section>
  );
}
