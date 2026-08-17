/**
 * Presentation-only SVG primitives adapted from WW-AI-Lab/openclaw-office
 * commit def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6 (MIT).
 * They deliberately contain no upstream store, Gateway, identity or runtime code.
 */

type Point = { x: number; y: number };

export function OfficeDesk({ x, y, active = false }: Point & { active?: boolean }) {
  return (
    <g data-openclaw-primitive="desk" transform={`translate(${x} ${y}) scale(.62)`}>
      <rect
        x="-50"
        y="-6"
        width="100"
        height="60"
        rx="7"
        fill="#d9aa6c"
        stroke="#9b6a37"
        strokeWidth="2"
      />
      <path d="M-50 54v5q0 6 6 6h88q6 0 6-6v-5" fill="#9b6a37" />
      <path d="M-45 14h90M-45 34h90" stroke="#b98145" opacity=".65" />
      <g transform="translate(0 14)">
        <rect x="-19" y="-12" width="38" height="25" rx="3" fill="#292524" />
        <rect
          className={active ? "office-monitor-active" : undefined}
          x="-16"
          y="-9"
          width="32"
          height="19"
          rx="2"
          fill={active ? "#0ea5e9" : "#64748b"}
        />
        <rect x="-4" y="13" width="8" height="5" rx="1" fill="#292524" />
        <rect x="-10" y="17" width="20" height="3" rx="1" fill="#292524" />
      </g>
      <rect x="-16" y="38" width="32" height="11" rx="2" fill="#d6d3d1" stroke="#a8a29e" />
      <circle cx="34" cy="43" r="5" fill="#dc8a5d" stroke="#9b6a37" />
    </g>
  );
}

export function OfficeMeetingTable({ x, y }: Point) {
  const gradientId = `office-meeting-${x}-${y}`;
  return (
    <g data-openclaw-primitive="meeting-table" transform={`translate(${x} ${y})`}>
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0" stopColor="#eccb98" />
          <stop offset="1" stopColor="#c99055" />
        </radialGradient>
      </defs>
      <circle r="55" fill={`url(#${gradientId})`} stroke="#916133" strokeWidth="3" />
      <circle r="37" fill="none" stroke="#916133" opacity=".3" />
      <rect x="5" y="-12" width="20" height="15" rx="2" fill="#44403c" transform="rotate(-8)" />
      <rect x="8" y="-9" width="14" height="9" rx="1" fill="#7dd3fc" transform="rotate(-8)" />
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 6;
        return (
          <rect
            key={angle}
            x={Math.cos(angle) * 78 - 9}
            y={Math.sin(angle) * 78 - 7}
            width="18"
            height="14"
            rx="5"
            fill="#527a73"
          />
        );
      })}
    </g>
  );
}

export function OfficeSofa({ x, y }: Point) {
  return (
    <g data-openclaw-primitive="sofa" transform={`translate(${x} ${y})`}>
      <rect
        x="-55"
        y="-23"
        width="110"
        height="46"
        rx="18"
        fill="#6d8f87"
        stroke="#345e58"
        strokeWidth="3"
      />
      <rect x="-44" y="-13" width="88" height="28" rx="12" fill="#8eaaa2" />
      <path d="M0-12v27" stroke="#527a73" strokeWidth="2" />
      <rect x="-61" y="-18" width="14" height="38" rx="7" fill="#527a73" />
      <rect x="47" y="-18" width="14" height="38" rx="7" fill="#527a73" />
    </g>
  );
}

export function OfficePlant({ x, y }: Point) {
  return (
    <g data-openclaw-primitive="plant" transform={`translate(${x} ${y})`}>
      <path d="M-13 4h26l-4 29H-9z" fill="#b86f45" stroke="#75432d" strokeWidth="2" />
      <path
        d="M0 5C-25-2-26-30-5-17C-4-40 18-38 11-14C31-24 35 3 8 7"
        fill="#5f966d"
        stroke="#356344"
        strokeWidth="2"
      />
    </g>
  );
}

function palette(seed: string) {
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const shirts = ["#ff9d66", "#62c6b4", "#e58eb9", "#e7c85f"];
  const hair = ["#40251d", "#68452f", "#292524", "#8b5e3c"];
  return {
    shirt: shirts[Math.abs(hash) % shirts.length] ?? shirts[0],
    hair: hair[Math.abs(hash >>> 5) % hair.length] ?? hair[0],
  };
}

export function OfficePawn({
  seed,
  working,
  reviewing,
}: {
  seed: string;
  working: boolean;
  reviewing: boolean;
}) {
  const colors = palette(seed);
  return (
    <svg
      aria-hidden="true"
      className="office-pawn"
      data-openclaw-primitive="pawn"
      viewBox="-18 -34 36 56"
    >
      <ellipse cx="0" cy="18" rx="12" ry="3" fill="rgba(0,0,0,.2)" />
      <g
        className={
          working ? "office-pawn-working" : reviewing ? "office-pawn-reviewing" : "office-pawn-idle"
        }
      >
        <g className="office-pawn-legs">
          <rect x="-7" y="5" width="6" height="13" rx="3" fill="#31506b" />
          <rect x="1" y="5" width="6" height="13" rx="3" fill="#31506b" />
        </g>
        <rect x="-10" y="-12" width="20" height="20" rx="7" fill={colors.shirt} stroke="#46352f" />
        <g className="office-pawn-arms">
          <rect x="-14" y="-9" width="5" height="15" rx="3" fill={colors.shirt} />
          <rect x="9" y="-9" width="5" height="15" rx="3" fill={colors.shirt} />
        </g>
        <circle cx="0" cy="-21" r="11" fill="#f1c39f" stroke="#46352f" />
        <path d="M-10-22q0-12 10-12t10 12q-5-5-10-5t-10 5" fill={colors.hair} />
        <g className="office-pawn-eyes" fill="#292524">
          <circle cx="-4" cy="-21" r="1.4" />
          <circle cx="4" cy="-21" r="1.4" />
        </g>
        <path d="M-2-16q2 2 4 0" fill="none" stroke="#8b4d49" strokeLinecap="round" />
      </g>
    </svg>
  );
}
