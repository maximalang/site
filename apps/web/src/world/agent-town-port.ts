import type { AgentProjectionCore, WorldView, WorldZone } from "@agent-world/read-model";

/**
 * Narrow adaptation of the Canvas sizing, centered-world coordinates and
 * pointer hit-testing patterns from rafapetter/agent-town at
 * 78e8e91b9c2620ff8048377f12048412ed603028 (MIT). Product domain, room model,
 * rendering and all state projection are intentionally rewritten. See
 * THIRD_PARTY_NOTICES.md and third-party/rafapetter-agent-town-LICENSE.txt.
 */

type ProjectedWorldAgent = WorldView["agents"][number];

export type LaidOutWorldAgent = AgentProjectionCore & {
  zone: WorldZone;
  x: number;
  y: number;
  radius: number;
};

type RoomRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const ZONE_ORDER: WorldZone[] = ["AGENT_HALL", "WORK_ROOM", "REVIEW_ROOM", "CONTROL_TOWER"];

const ZONE_LABEL: Record<WorldZone, string> = {
  AGENT_HALL: "Agent Hall",
  WORK_ROOM: "Work Room",
  REVIEW_ROOM: "Review Room",
  CONTROL_TOWER: "Control Tower",
};

const STATUS_COLOR: Record<AgentProjectionCore["status"], string> = {
  IDLE: "#84a7a0",
  QUEUED: "#d5a95d",
  RUNNING: "#56c99f",
  WAITING_APPROVAL: "#e0b85b",
  BLOCKED: "#e17c64",
  FAILED: "#e36b68",
  OFFLINE: "#71817f",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roomRects(width: number, height: number): Record<WorldZone, RoomRect> {
  const padding = clamp(Math.min(width, height) * 0.045, 18, 46);
  const corridor = clamp(Math.min(width, height) * 0.04, 18, 34);
  const roomWidth = Math.max(80, (width - padding * 2 - corridor) / 2);
  const roomHeight = Math.max(80, (height - padding * 2 - corridor) / 2);
  return {
    AGENT_HALL: { x: padding, y: padding, width: roomWidth, height: roomHeight },
    WORK_ROOM: {
      x: padding + roomWidth + corridor,
      y: padding,
      width: roomWidth,
      height: roomHeight,
    },
    REVIEW_ROOM: {
      x: padding,
      y: padding + roomHeight + corridor,
      width: roomWidth,
      height: roomHeight,
    },
    CONTROL_TOWER: {
      x: padding + roomWidth + corridor,
      y: padding + roomHeight + corridor,
      width: roomWidth,
      height: roomHeight,
    },
  };
}

export function layoutWorldAgents(
  width: number,
  height: number,
  agents: ProjectedWorldAgent[],
): LaidOutWorldAgent[] {
  const safeWidth = Math.max(240, width);
  const safeHeight = Math.max(320, height);
  const rooms = roomRects(safeWidth, safeHeight);
  const result: LaidOutWorldAgent[] = [];

  for (const zone of ZONE_ORDER) {
    const zoneAgents = agents
      .filter((agent) => agent.world.zone === zone)
      .sort(
        (left, right) =>
          left.world.slot.row - right.world.slot.row ||
          left.world.slot.column - right.world.slot.column ||
          left.core.agentId.localeCompare(right.core.agentId),
      );
    const room = rooms[zone];
    const columns = Math.max(
      1,
      Math.ceil(Math.sqrt((zoneAgents.length * room.width) / Math.max(room.height, 1))),
    );
    const rows = Math.max(1, Math.ceil(zoneAgents.length / columns));
    const cellWidth = room.width / (columns + 1);
    const cellHeight = (room.height - 26) / (rows + 1);
    const radius = clamp(Math.min(cellWidth, cellHeight) * 0.24, 4, 17);

    zoneAgents.forEach((agent, index) => {
      result.push({
        ...agent.core,
        zone,
        x: room.x + cellWidth * ((index % columns) + 1),
        y: room.y + 24 + cellHeight * (Math.floor(index / columns) + 1),
        radius,
      });
    });
  }
  return result;
}

export function getWorldAgentAt(
  x: number,
  y: number,
  agents: LaidOutWorldAgent[],
): LaidOutWorldAgent | null {
  for (let index = agents.length - 1; index >= 0; index -= 1) {
    const agent = agents[index];
    if (!agent) {
      continue;
    }
    const hitRadius = Math.max(18, agent.radius * 1.8);
    if (Math.hypot(x - agent.x, y - agent.y) <= hitRadius) {
      return agent;
    }
  }
  return null;
}

function drawRoom(context: CanvasRenderingContext2D, room: RoomRect, zone: WorldZone): void {
  context.fillStyle = zone === "CONTROL_TOWER" ? "#172522" : "#1b2b28";
  context.fillRect(room.x, room.y, room.width, room.height);
  context.strokeStyle = "#3b514b";
  context.lineWidth = 1;
  context.strokeRect(room.x + 0.5, room.y + 0.5, room.width - 1, room.height - 1);
  context.fillStyle = "#9fb4ad";
  context.font = "600 11px ui-monospace, monospace";
  context.textBaseline = "top";
  context.fillText(ZONE_LABEL[zone].toUpperCase(), room.x + 12, room.y + 10);
}

function drawAgent(
  context: CanvasRenderingContext2D,
  agent: LaidOutWorldAgent,
  selected: boolean,
): void {
  const size = agent.radius;
  context.save();
  context.translate(Math.round(agent.x), Math.round(agent.y));
  context.fillStyle = selected ? "#f0d59a" : "#c8d5cf";
  context.fillRect(-size * 0.55, -size * 1.5, size * 1.1, size * 0.85);
  context.fillStyle = STATUS_COLOR[agent.status];
  context.fillRect(-size * 0.8, -size * 0.55, size * 1.6, size * 1.45);
  context.fillStyle = "#101916";
  context.fillRect(-size * 0.65, size * 0.9, size * 0.5, size * 0.65);
  context.fillRect(size * 0.15, size * 0.9, size * 0.5, size * 0.65);
  if (selected) {
    context.strokeStyle = "#f0d59a";
    context.lineWidth = 2;
    context.strokeRect(-size - 4, -size * 1.75 - 4, size * 2 + 8, size * 3.4 + 8);
  }
  if (size >= 10) {
    context.fillStyle = "#e5ece8";
    context.font = "600 10px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(agent.displayName, 0, size * 1.75, Math.max(80, size * 6));
  }
  context.restore();
}

export function renderAgentTown(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  agents: ProjectedWorldAgent[],
  selectedAgentId?: string,
): LaidOutWorldAgent[] {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0d1513";
  context.fillRect(0, 0, width, height);
  const rooms = roomRects(Math.max(240, width), Math.max(320, height));
  for (const zone of ZONE_ORDER) {
    drawRoom(context, rooms[zone], zone);
  }
  const layout = layoutWorldAgents(width, height, agents);
  for (const agent of layout) {
    drawAgent(context, agent, agent.agentId === selectedAgentId);
  }
  return layout;
}
