"use client";

import type { AgentProjectionCore, WorldView } from "@agent-world/read-model";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./phase6-world.module.css";
import {
  advancePosition,
  clampCamera,
  clampZoom,
  fitWorldCamera,
  initialCameraForAgents,
  spriteIdentity,
  statusVisual,
  targetForAgent,
  WORLD_SIZE,
  type WorldPoint,
} from "./world-presentation";

type AgentId = WorldView["agents"][number]["core"]["agentId"];
type Facing = "down" | "left" | "right" | "up";
type Motion = { x: number; y: number; facing: Facing; moving: boolean };
type Camera = { x: number; y: number; zoom: number };
type OpenClawOfficeWorldProps = {
  world: WorldView;
  selectedAgentId: AgentId | undefined;
  onSelectAgent: (id: AgentId) => void;
  onOpenConversation: (id: AgentId) => void;
};

const STATUS_COPY: Record<AgentProjectionCore["status"], string> = {
  IDLE: "Свободен",
  QUEUED: "В очереди",
  RUNNING: "Выполняет",
  WAITING_APPROVAL: "Ждёт подтверждения",
  BLOCKED: "Заблокирован",
  FAILED: "Ошибка",
  OFFLINE: "Не в сети",
};

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
) {
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, alternate: boolean) {
  rect(ctx, x - 5, y + 15, 10, 23, "#6b4b31");
  rect(ctx, x - 20, y - 3, 40, 29, alternate ? "#3e7040" : "#315d37");
  rect(ctx, x - 13, y - 14, 27, 23, alternate ? "#5b8b4f" : "#4f8247");
  rect(ctx, x - 26, y + 8, 16, 13, "#315d37");
  rect(ctx, x + 11, y + 7, 15, 15, "#315d37");
}

function building(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
  wall: string,
  label: string,
) {
  rect(ctx, x + 7, y + 10, w, h, "#3d563e");
  rect(ctx, x, y, w, h, wall);
  rect(ctx, x - 8, y - 24, w + 16, 34, roof);
  rect(ctx, x - 4, y - 29, w + 8, 7, "#4c3a2f");
  rect(ctx, x + w / 2 - 13, y + h - 37, 26, 37, "#5b4030");
  rect(ctx, x + 18, y + 24, 28, 22, "#9bd8cf");
  rect(ctx, x + w - 46, y + 24, 28, 22, "#9bd8cf");
  ctx.fillStyle = "#2c382e";
  ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, y + h + 22);
}

function createMap(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WORLD_SIZE.width;
  canvas.height = WORLD_SIZE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < WORLD_SIZE.height; y += 32) {
    for (let x = 0; x < WORLD_SIZE.width; x += 32) {
      rect(ctx, x, y, 32, 32, ((x + y) / 32) % 2 === 0 ? "#7dae61" : "#75a85b");
      if ((x * 7 + y * 11) % 224 === 0) {
        rect(ctx, x + 9, y + 11, 3, 5, "#c6db82");
        rect(ctx, x + 14, y + 14, 3, 4, "#f1df86");
      }
    }
  }
  // River, shore and wooden bridge.
  rect(ctx, 1280, 0, 256, 960, "#3b8fa4");
  rect(ctx, 1258, 0, 24, 960, "#c8b77d");
  for (let y = 16; y < 945; y += 34) {
    rect(ctx, 1302 + ((y / 34) % 2) * 28, y, 36, 4, "#79c8d1");
    rect(ctx, 1410 - ((y / 34) % 3) * 17, y + 13, 42, 3, "#2d778d");
  }
  rect(ctx, 1234, 446, 302, 80, "#6d4d32");
  for (let x = 1242; x < 1536; x += 20) rect(ctx, x, 452, 13, 68, "#b0814d");
  // Town paths.
  rect(ctx, 90, 446, 1170, 86, "#d2bc79");
  rect(ctx, 738, 90, 92, 760, "#d2bc79");
  rect(ctx, 308, 255, 105, 200, "#d2bc79");
  rect(ctx, 1075, 253, 105, 200, "#d2bc79");
  rect(ctx, 1095, 525, 82, 190, "#d2bc79");
  for (let x = 96; x < 1230; x += 48) rect(ctx, x, 456, 24, 5, "#e7d596");
  for (let y = 110; y < 825; y += 48) rect(ctx, 750, y, 7, 24, "#e7d596");
  // Central collaboration pavilion.
  rect(ctx, 690, 407, 192, 144, "#4a724e");
  rect(ctx, 704, 421, 164, 114, "#d8ce91");
  rect(ctx, 720, 437, 132, 82, "#6d5136");
  rect(ctx, 730, 447, 112, 62, "#c59758");
  rect(ctx, 754, 460, 64, 10, "#e4bd6a");
  building(ctx, 260, 155, 245, 145, "#527047", "#ead99b", "RESEARCH GROVE");
  building(ctx, 1000, 145, 225, 155, "#7c5e55", "#e6c995", "REVIEW HOUSE");
  building(ctx, 1030, 650, 225, 145, "#425f68", "#c8d3bc", "OPERATIONS");
  // Commons and garden.
  rect(ctx, 250, 625, 360, 185, "#6d9b55");
  rect(ctx, 306, 672, 246, 92, "#b99f65");
  rect(ctx, 382, 704, 95, 18, "#6d4e36");
  rect(ctx, 418, 670, 18, 86, "#6d4e36");
  ctx.fillStyle = "#2c382e";
  ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText("COMMONS", 430, 832);
  rect(ctx, 570, 175, 150, 152, "#5b6e43");
  for (let row = 0; row < 4; row += 1)
    for (let col = 0; col < 4; col += 1) {
      rect(ctx, 588 + col * 31, 194 + row * 31, 18, 18, "#80603d");
      rect(ctx, 594 + col * 31, 191 + row * 31, 6, 12, row % 2 ? "#d78852" : "#7fb857");
    }
  const trees: Array<[number, number]> = [
    [92, 100],
    [145, 172],
    [90, 300],
    [175, 366],
    [90, 680],
    [150, 820],
    [660, 82],
    [900, 92],
    [930, 356],
    [930, 695],
    [660, 744],
    [614, 862],
    [940, 850],
    [1205, 95],
    [1200, 355],
    [1208, 840],
    [214, 92],
    [555, 94],
    [550, 390],
    [915, 585],
  ];
  trees.forEach(([x, y], index) => {
    tree(ctx, x, y, index % 2 === 0);
  });
  for (let index = 0; index < 28; index += 1) {
    const x = 120 + ((index * 137) % 1070);
    const y = 95 + ((index * 211) % 760);
    if (x > 690 && x < 890 && y > 380 && y < 570) continue;
    rect(ctx, x, y, 5, 5, index % 3 === 0 ? "#f0d8e7" : "#f3e681");
    rect(ctx, x + 1, y + 5, 2, 5, "#457649");
  }
  return canvas;
}

function facingFrom(dx: number, dy: number, previous: Facing): Facing {
  if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return previous;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: AgentProjectionCore,
  motion: Motion,
  selected: boolean,
  speaking: boolean,
  time: number,
) {
  const identity = spriteIdentity(agent.agentId);
  const visual = statusVisual(agent.status);
  const frame = motion.moving ? Math.floor(time / 170) % 2 : 0;
  const bob = motion.moving ? frame * 2 : 0;
  ctx.save();
  ctx.globalAlpha = visual.opacity;
  if (selected) {
    ctx.fillStyle = "#fff4a8";
    ctx.beginPath();
    ctx.ellipse(motion.x, motion.y + 25, 27, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#45533f";
    ctx.beginPath();
    ctx.ellipse(motion.x, motion.y + 25, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const x = Math.round(motion.x - 18);
  const y = Math.round(motion.y - 44 - bob);
  rect(ctx, x + 8, y + 50, 9, 9, "#30372f");
  rect(ctx, x + 22, y + 50 - frame * 2, 9, 9 + frame * 2, "#30372f");
  rect(ctx, x + 6, y + 25, 28, 28, identity.coat);
  rect(ctx, x + 9, y + 31, 22, 7, identity.accent);
  rect(ctx, x + 10, y + 10, 20, 18, "#e6b98b");
  rect(ctx, x + 8, y + 5, 24, 9, identity.hair);
  if (motion.facing === "up") rect(ctx, x + 10, y + 10, 20, 15, identity.hair);
  else if (motion.facing === "left") rect(ctx, x + 12, y + 18, 3, 3, "#273129");
  else if (motion.facing === "right") rect(ctx, x + 27, y + 18, 3, 3, "#273129");
  else {
    rect(ctx, x + 15, y + 18, 3, 3, "#273129");
    rect(ctx, x + 25, y + 18, 3, 3, "#273129");
  }
  if (visual.state === "blocked") {
    ctx.strokeStyle = "#d9664a";
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 3, y + 2, 35, 59);
  }
  const bubble = speaking ? "speech" : agent.status === "RUNNING" ? "thought" : undefined;
  if (bubble) {
    ctx.fillStyle = "#fff8d8";
    ctx.strokeStyle = "#39483b";
    ctx.lineWidth = 3;
    if (bubble === "speech") {
      ctx.fillRect(motion.x - 24, motion.y - 83, 48, 29);
      ctx.strokeRect(motion.x - 24, motion.y - 83, 48, 29);
      rect(ctx, motion.x - 12, motion.y - 54, 8, 8, "#fff8d8");
    } else {
      ctx.beginPath();
      ctx.arc(motion.x, motion.y - 68, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      rect(ctx, motion.x - 7, motion.y - 46, 6, 6, "#fff8d8");
    }
    for (let dot = 0; dot < 3; dot += 1)
      rect(
        ctx,
        motion.x - 11 + dot * 10,
        bubble === "speech" ? motion.y - 72 : motion.y - 71,
        4,
        4,
        "#50614e",
      );
  }
  ctx.globalAlpha = visual.opacity;
  ctx.fillStyle = "rgb(24 35 28 / 88%)";
  ctx.fillRect(motion.x - 60, motion.y + 34, 120, 21);
  ctx.fillStyle = "#fff8db";
  ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(agent.displayName.slice(0, 18), motion.x, motion.y + 49);
  ctx.restore();
}

function toWorld(point: WorldPoint, camera: Camera, viewport: WorldPoint): WorldPoint {
  return {
    x: (point.x - viewport.x / 2) / camera.zoom + camera.x,
    y: (point.y - viewport.y / 2) / camera.zoom + camera.y,
  };
}

export function OpenClawOfficeWorld({
  world,
  selectedAgentId,
  onSelectAgent,
  onOpenConversation,
}: OpenClawOfficeWorldProps) {
  const agents = useMemo(() => world.agents.map((entry) => entry.core), [world.agents]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const motionsRef = useRef(new Map<AgentId, Motion>());
  const cameraRef = useRef<Camera>({
    x: WORLD_SIZE.width / 2,
    y: WORLD_SIZE.height / 2,
    zoom: 1,
  });
  const cameraInitializedRef = useRef(false);
  const sizeRef = useRef<WorldPoint>({ x: 900, y: 700 });
  const pointersRef = useRef(new Map<number, WorldPoint>());
  const dragRef = useRef<
    { id: number; start: WorldPoint; camera: Camera; moved: boolean } | undefined
  >(undefined);
  const pinchRef = useRef<{ distance: number; zoom: number } | undefined>(undefined);
  const [replayId, setReplayId] = useState<string>();
  const [speakingAgentId, setSpeakingAgentId] = useState<AgentId>();
  const reducedMotionRef = useRef(false);
  const latestHandoff = world.handoffs.at(-1);
  const replay = replayId ? world.handoffs.find((handoff) => handoff.id === replayId) : undefined;
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.agentId, agent])), [agents]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mapRef.current ??= createMap();
  }, []);

  useEffect(() => {
    if (!replayId) return;
    const timer = window.setTimeout(
      () => setReplayId(undefined),
      reducedMotionRef.current ? 2400 : 6500,
    );
    return () => window.clearTimeout(timer);
  }, [replayId]);

  useEffect(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return;
    const resize = () => {
      const bounds = shell.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = { x: Math.max(1, bounds.width), y: Math.max(1, bounds.height) };
      sizeRef.current = viewport;
      if (!cameraInitializedRef.current && bounds.width > 1 && bounds.height > 1) {
        cameraRef.current = initialCameraForAgents(agents, viewport);
        cameraInitializedRef.current = true;
      } else if (cameraInitializedRef.current) {
        const zoom = clampZoom(cameraRef.current.zoom);
        cameraRef.current = { ...clampCamera(cameraRef.current, zoom, viewport), zoom };
      }
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    resize();
    return () => observer.disconnect();
  }, [agents]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const render = (now: number) => {
      const canvas = canvasRef.current;
      const map = mapRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && map && ctx) {
        const delta = Math.min(50, now - previous);
        previous = now;
        const ratio = canvas.width / Math.max(1, sizeRef.current.x);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, sizeRef.current.x, sizeRef.current.y);
        const camera = cameraRef.current;
        ctx.save();
        ctx.translate(sizeRef.current.x / 2, sizeRef.current.y / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);
        ctx.drawImage(map, 0, 0);
        agents.forEach((agent, index) => {
          const target = targetForAgent(agent, index, replay);
          const existing = motionsRef.current.get(agent.agentId) ?? {
            x: target.x,
            y: target.y,
            facing: "down" as Facing,
            moving: false,
          };
          const advanced = advancePosition(existing, target, delta, reducedMotionRef.current);
          const dx = advanced.point.x - existing.x;
          const dy = advanced.point.y - existing.y;
          const motion: Motion = {
            ...advanced.point,
            facing: facingFrom(dx, dy, existing.facing),
            moving: advanced.moving,
          };
          motionsRef.current.set(agent.agentId, motion);
          drawAgent(
            ctx,
            agent,
            motion,
            selectedAgentId === agent.agentId,
            speakingAgentId === agent.agentId ||
              Boolean(
                replay &&
                  (replay.fromAgentId === agent.agentId || replay.toAgentId === agent.agentId),
              ),
            now,
          );
        });
        ctx.restore();
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [agents, replay, selectedAgentId, speakingAgentId]);

  const setCamera = (next: Camera) => {
    const zoom = clampZoom(next.zoom);
    const clamped = clampCamera(next, zoom, sizeRef.current);
    cameraRef.current = { ...clamped, zoom };
  };
  const resetCamera = () => setCamera(fitWorldCamera(sizeRef.current));
  const focusSelected = () => {
    if (!selectedAgentId) return;
    const motion = motionsRef.current.get(selectedAgentId);
    if (motion) setCamera({ x: motion.x, y: motion.y, zoom: 1.45 });
  };
  const local = (event: ReactPointerEvent<HTMLCanvasElement>): WorldPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = local(event);
    pointersRef.current.set(event.pointerId, point);
    dragRef.current = {
      id: event.pointerId,
      start: point,
      camera: { ...cameraRef.current },
      moved: false,
    };
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      if (a && b)
        pinchRef.current = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: cameraRef.current.zoom,
        };
    }
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = local(event);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      if (a && b)
        setCamera({
          ...cameraRef.current,
          zoom:
            (pinchRef.current.zoom * Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))) /
            pinchRef.current.distance,
        });
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    setCamera({
      x: drag.camera.x - dx / cameraRef.current.zoom,
      y: drag.camera.y - dy / cameraRef.current.zoom,
      zoom: cameraRef.current.zoom,
    });
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = local(event);
    const drag = dragRef.current;
    if (drag && drag.id === event.pointerId && !drag.moved && pointersRef.current.size === 1) {
      const worldPoint = toWorld(point, cameraRef.current, sizeRef.current);
      let hit: { id: AgentId; distance: number } | undefined;
      for (const [id, motion] of motionsRef.current) {
        const distance = Math.hypot(worldPoint.x - motion.x, worldPoint.y - motion.y);
        if (distance <= 48 && (!hit || distance < hit.distance)) hit = { id, distance };
      }
      if (hit) onSelectAgent(hit.id);
    }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    if (drag?.id === event.pointerId) dragRef.current = undefined;
  };
  const wheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const before = toWorld(cursor, cameraRef.current, sizeRef.current);
    const zoom = clampZoom(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.0012));
    const after = toWorld(cursor, { ...cameraRef.current, zoom }, sizeRef.current);
    setCamera({
      x: cameraRef.current.x + before.x - after.x,
      y: cameraRef.current.y + before.y - after.y,
      zoom,
    });
  };
  const openConversation = (id: AgentId) => {
    setSpeakingAgentId(id);
    onOpenConversation(id);
  };
  const replayFrom = replay ? byId.get(replay.fromAgentId) : undefined;
  const replayTo = replay ? byId.get(replay.toAgentId) : undefined;
  const selected = selectedAgentId ? byId.get(selectedAgentId) : undefined;
  const selectedHandoff = selected
    ? [...world.handoffs]
        .reverse()
        .find(
          (handoff) =>
            handoff.fromAgentId === selected.agentId || handoff.toAgentId === selected.agentId,
        )
    : undefined;
  const selectedPeer = selectedHandoff
    ? byId.get(
        selectedHandoff.fromAgentId === selectedAgentId
          ? selectedHandoff.toAgentId
          : selectedHandoff.fromAgentId,
      )
    : undefined;

  return (
    <section
      aria-label="Карта World"
      className={`${styles.sceneShell} phase6-world`}
      data-renderer="agent-world-canvas-v1"
      data-skin="openclaw-office-open-floor-v1"
      data-testid="openclaw-office-world"
    >
      <div className={styles.scene} ref={shellRef}>
        <canvas
          aria-label="Интерактивная пиксельная карта мира агентов. Перетаскивайте для панорамирования, колесо или жест щипка меняет масштаб. Для клавиатуры используйте список агентов."
          className={styles.canvas}
          data-testid="agent-world-canvas"
          onPointerCancel={pointerEnd}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onWheel={wheel}
          ref={canvasRef}
          tabIndex={0}
        />
        <div className={styles.hud}>
          <p className={styles.title}>Agent World</p>
          <fieldset className={styles.controls}>
            <legend className={styles.srOnly}>Управление картой</legend>
            {latestHandoff ? (
              <button
                className={styles.handoff}
                onClick={() => setReplayId(latestHandoff.id)}
                type="button"
              >
                Показать передачу
              </button>
            ) : null}
            <button
              className={styles.control}
              disabled={!selectedAgentId}
              onClick={focusSelected}
              type="button"
            >
              К агенту
            </button>
            <button className={styles.control} onClick={resetCamera} type="button">
              Весь мир
            </button>
          </fieldset>
        </div>
        {replay && replayFrom && replayTo ? (
          <div className={styles.handoffToast} data-handoff-cue role="status">
            Передача: {replayFrom.displayName} → {replayTo.displayName}
          </div>
        ) : null}
        {selected ? (
          <div className={styles.eventFeed} aria-live="polite">
            <p>
              <strong>{selected.displayName}</strong> · {STATUS_COPY[selected.status]}
            </p>
            <p>{selected.currentTask?.title ?? "Нет активной задачи"}</p>
            {selectedHandoff && selectedPeer ? <p>Передача с {selectedPeer.displayName}</p> : null}
          </div>
        ) : null}
        <nav aria-label="Агенты мира" className={styles.agentNav}>
          {agents.map((agent) => {
            const identity = spriteIdentity(agent.agentId);
            const style = {
              "--coat": identity.coat,
              "--accent": identity.accent,
              "--hair": identity.hair,
            } as CSSProperties;
            return (
              <button
                aria-label={`${agent.displayName}: ${STATUS_COPY[agent.status]}`}
                aria-pressed={agent.agentId === selectedAgentId}
                className={styles.agentButton}
                data-selected={agent.agentId === selectedAgentId}
                key={agent.agentId}
                onClick={() => onSelectAgent(agent.agentId)}
                onDoubleClick={() => openConversation(agent.agentId)}
                style={style}
                type="button"
              >
                <span aria-hidden="true" className={styles.miniSprite} />
                <span className={styles.agentCopy}>
                  <strong>{agent.displayName}</strong>
                  <small>{STATUS_COPY[agent.status]}</small>
                </span>
              </button>
            );
          })}
        </nav>
        <span className={styles.srOnly}>
          Двойной клик по кнопке агента открывает диалог. Каноническое состояние и передачи не
          изменяются движением персонажей.
        </span>
      </div>
    </section>
  );
}
