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
import styles from "./openclaw-office-world.module.css";

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

const STATUS_SHORT: Record<OfficeVisualStatus, string> = {
  IDLE: "IDLE",
  QUEUED: "QUEUE",
  WORKING: "WORK",
  REVIEWING: "REVIEW",
  BLOCKED: "BLOCKED",
  ERROR: "ERROR",
  OFFLINE: "OFFLINE",
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

function EnvironmentDetails({ theme }: { theme: string }) {
  return (
    <g className={styles.environmentDetails} data-environment-theme={theme}>
      <rect className={styles.window} x="84" y="90" width="168" height="54" rx="15" />
      <path
        d="M104 117h128"
        stroke="rgb(211 236 226 / 10%)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect className={styles.window} x="970" y="92" width="142" height="48" rx="14" />
      <path
        d="M991 116h100"
        stroke="rgb(211 236 226 / 10%)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect className={styles.rug} x="91" y="315" width="184" height="145" rx="52" />
      <rect className={styles.rug} x="822" y="278" width="107" height="145" rx="48" />
      <g opacity=".45">
        <circle cx="326" cy="108" r="4" fill="#e9cc91" />
        <circle cx="770" cy="602" r="4" fill="#76cbb2" />
        <circle cx="952" cy="176" r="4" fill="#85b9dc" />
      </g>
    </g>
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
    <section aria-label="Карта World" className={styles.sceneShell}>
      <div className={`${styles.skinControls} memory-launch-controls world-skin-controls`}>
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
        className={`${styles.scene} openclaw-office-world office-world`}
        style={{ aspectRatio: `${office.width} / ${office.height}` }}
        data-skin={office.skinId}
        data-theme={skin.theme}
      >
        <svg
          aria-label={`${skin.label}: карта World с четырьмя рабочими зонами`}
          className={`${styles.floor} office-floor`}
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
            className={`${styles.floorBase} office-floor-base`}
            height={office.height}
            rx="30"
            style={{ fill: skin.palette.floor }}
            width={office.width}
          />
          <rect
            className={`${styles.floorGrid} office-floor-grid`}
            width={office.width}
            height={office.height}
            rx="30"
          />
          <rect
            className={styles.perimeter}
            x="24"
            y="24"
            width={office.width - 48}
            height={office.height - 48}
            rx="34"
          />
          <path
            className={styles.walkway}
            d="M188 350C314 296 389 351 504 351S702 296 830 351s181 8 245-42"
          />
          <path
            className={styles.walkwayEdge}
            d="M188 350C314 296 389 351 504 351S702 296 830 351s181 8 245-42"
          />
          {office.zones.map((zone) => (
            <g data-testid="office-zone" key={zone.id}>
              <rect
                className={`${styles.zone} office-zone office-zone-${zone.id.toLowerCase()}`}
                height={zone.height}
                rx="38"
                style={{ fill: skin.palette.zones[zone.id] }}
                width={zone.width}
                x={zone.x}
                y={zone.y}
              />
              <text
                className={`${styles.zoneLabel} office-zone-label`}
                x={zone.x + 20}
                y={zone.y + 31}
              >
                {zone.label}
              </text>
            </g>
          ))}
          <EnvironmentDetails theme={skin.theme} />
          {skin.theme === "OPENCLAW_OFFICE" ? (
            <g className="office-furniture">
              <OfficeDesk active={activeDeskCount > 0} x={455} y={166} />
              <OfficeDesk active={activeDeskCount > 1} x={645} y={166} />
              <OfficeDesk active={activeDeskCount > 2} x={455} y={465} />
              <OfficeDesk active={activeDeskCount > 3} x={645} y={465} />
              <OfficeMeetingTable x={875} y={350} />
              <OfficeSofa x={183} y={235} />
              <OfficeSofa x={183} y={506} />
              <OfficePlant x={95} y={173} />
              <OfficePlant x={290} y={575} />
              <OfficePlant x={1110} y={556} />
            </g>
          ) : null}
          <g className="office-handoff-layer" style={{ color: skin.palette.accent }}>
            {office.handoffs.map((handoff) => (
              <path
                className={`${styles.handoffPath} office-handoff-path`}
                d={`M${handoff.fromX} ${handoff.fromY} Q${(handoff.fromX + handoff.toX) / 2} ${Math.min(handoff.fromY, handoff.toY) - 70} ${handoff.toX} ${handoff.toY}`}
                data-handoff-cue={handoff.id}
                key={handoff.id}
                pathLength="1"
              />
            ))}
          </g>
        </svg>
        {office.handoffs.map((handoff) => (
          <span
            aria-hidden="true"
            className={styles.handoffPacket}
            data-handoff-packet={handoff.id}
            key={`packet-${handoff.id}`}
            style={{
              left: `${((handoff.fromX + handoff.toX) / 2 / office.width) * 100}%`,
              top: `${((Math.min(handoff.fromY, handoff.toY) - 42) / office.height) * 100}%`,
            }}
          >
            передача
          </span>
        ))}
        {office.agents.map((agent) => (
          <button
            aria-label={`${agent.displayName}: ${agent.statusLabel}. Открыть карточку агента`}
            className={`${styles.agent} office-agent office-agent-${agent.visualStatus.toLowerCase()}${selectedAgentId === agent.agentId ? " is-selected" : ""}`}
            data-action-cue={agent.actionCue}
            data-selected={selectedAgentId === agent.agentId}
            data-status={agent.visualStatus}
            key={agent.agentId}
            onClick={() => onSelectAgent(agent.agentId)}
            onDoubleClick={() => onOpenConversation(agent.agentId)}
            style={{
              left: `${(agent.x / office.width) * 100}%`,
              top: `${(agent.y / office.height) * 100}%`,
            }}
            type="button"
          >
            <span className={styles.characterWrap}>
              <AgentPawn agent={agent} />
              <span
                aria-hidden="true"
                className={styles.statusBubble}
                data-status={agent.visualStatus}
              >
                <span>{STATUS_SHORT[agent.visualStatus]}</span>
              </span>
            </span>
            <span className={styles.nameplate}>
              <span className={`${styles.agentName} office-agent-name`}>{agent.displayName}</span>
              <span className={styles.agentRole}>{agent.role}</span>
            </span>
          </button>
        ))}
        {office.handoffs.length > 0 ? (
          <ol
            aria-label="Последние передачи работы"
            className={`${styles.handoffFeed} office-handoff-feed`}
          >
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
