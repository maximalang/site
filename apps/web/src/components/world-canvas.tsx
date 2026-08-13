"use client";

import type { WorldView } from "@agent-world/read-model";
import { useEffect, useRef } from "react";
import { getWorldAgentAt, type LaidOutWorldAgent, renderAgentTown } from "../world/agent-town-port";

type AgentId = WorldView["agents"][number]["core"]["agentId"];

type WorldCanvasProps = {
  agents: WorldView["agents"];
  selectedAgentId: AgentId | undefined;
  onSelectAgent: (agentId: AgentId) => void;
};

export function WorldCanvas({ agents, selectedAgentId, onSelectAgent }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<LaidOutWorldAgent[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(240, Math.round(rect.width * pixelRatio));
      const height = Math.max(320, Math.round(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.imageSmoothingEnabled = false;
      layoutRef.current = renderAgentTown(context, width, height, agents, selectedAgentId);
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [agents, selectedAgentId]);

  const handlePointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    const agent = getWorldAgentAt(x, y, layoutRef.current);
    if (agent) {
      onSelectAgent(agent.agentId);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      aria-label="Карта AI World. Выберите агента в доступном списке рядом с картой."
      onClick={(event) => handlePointer(event.clientX, event.clientY)}
      role="img"
    >
      Интерактивная карта агентов. Все агенты доступны в списке рядом с картой.
    </canvas>
  );
}
