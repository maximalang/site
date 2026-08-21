type Point = { x: number; y: number };

export function OfficeDesk({ x, y, active = false }: Point & { active?: boolean }) {
  return (
    <g data-openclaw-primitive="desk" transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="42" rx="62" ry="13" fill="rgb(0 0 0 / 14%)" />
      <path d="M-56 9h112l-8 48h-96z" fill="#8f603f" />
      <path d="M-51 4h102l8 13H-59z" fill="#d19a62" stroke="#795137" strokeWidth="3" />
      <path d="M-43 57v20M43 57v20" stroke="#6f4934" strokeWidth="8" strokeLinecap="round" />
      <g transform="translate(0 -8)">
        <rect
          x="-28"
          y="-21"
          width="56"
          height="36"
          rx="7"
          fill="#26332f"
          stroke="#111b18"
          strokeWidth="3"
        />
        <rect
          className={active ? "office-monitor-active" : undefined}
          x="-23"
          y="-16"
          width="46"
          height="26"
          rx="4"
          fill={active ? "#74d9c0" : "#60756e"}
        />
        <path d="M-14 2h28" stroke="#dff7ed" strokeOpacity=".45" strokeWidth="2" />
        <path d="M0 15v10M-13 25h26" stroke="#1a2421" strokeWidth="4" strokeLinecap="round" />
      </g>
      <rect x="-25" y="28" width="50" height="12" rx="4" fill="#e4dcc8" />
      <circle cx="39" cy="33" r="7" fill="#b85e48" />
      <path d="M35 25q4-8 9-2" fill="none" stroke="#4f7f5d" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

export function OfficeMeetingTable({ x, y }: Point) {
  const gradientId = `office-meeting-${x}-${y}`;
  return (
    <g data-openclaw-primitive="meeting-table" transform={`translate(${x} ${y})`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ddb379" />
          <stop offset="1" stopColor="#9f7048" />
        </linearGradient>
      </defs>
      <ellipse cy="54" rx="70" ry="16" fill="rgb(0 0 0 / 13%)" />
      <ellipse ry="48" rx="74" fill={`url(#${gradientId})`} stroke="#754f35" strokeWidth="4" />
      <ellipse ry="32" rx="54" fill="none" stroke="#754f35" strokeOpacity=".25" strokeWidth="2" />
      <rect x="6" y="-14" width="28" height="19" rx="4" fill="#29332f" transform="rotate(-7)" />
      <rect x="10" y="-10" width="20" height="11" rx="2" fill="#87c7dc" transform="rotate(-7)" />
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 6;
        return (
          <g
            key={angle}
            transform={`translate(${Math.cos(angle) * 94} ${Math.sin(angle) * 66}) rotate(${(angle * 180) / Math.PI + 90})`}
          >
            <rect
              x="-13"
              y="-10"
              width="26"
              height="20"
              rx="8"
              fill="#446e65"
              stroke="#294b44"
              strokeWidth="2"
            />
            <path d="M-8 9v11M8 9v11" stroke="#294b44" strokeWidth="4" strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
}

export function OfficeSofa({ x, y }: Point) {
  return (
    <g data-openclaw-primitive="sofa" transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="32" rx="66" ry="12" fill="rgb(0 0 0 / 12%)" />
      <rect
        x="-59"
        y="-25"
        width="118"
        height="51"
        rx="20"
        fill="#51756d"
        stroke="#2e514a"
        strokeWidth="3"
      />
      <rect x="-48" y="-13" width="96" height="32" rx="13" fill="#78968e" />
      <path d="M0-12v30" stroke="#52756d" strokeWidth="2" />
      <rect x="-65" y="-18" width="16" height="40" rx="8" fill="#3c675f" />
      <rect x="49" y="-18" width="16" height="40" rx="8" fill="#3c675f" />
      <rect x="-45" y="20" width="12" height="10" rx="4" fill="#294b44" />
      <rect x="33" y="20" width="12" height="10" rx="4" fill="#294b44" />
    </g>
  );
}

export function OfficePlant({ x, y }: Point) {
  return (
    <g data-openclaw-primitive="plant" transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="35" rx="22" ry="7" fill="rgb(0 0 0 / 11%)" />
      <path d="M-18 3h36l-5 34h-26z" fill="#b96d4e" stroke="#744534" strokeWidth="3" />
      <path
        d="M0 6C-29 0-31-32-6-18C-8-48 20-46 13-16C36-28 40 5 8 9"
        fill="#5a9268"
        stroke="#356246"
        strokeWidth="3"
      />
      <path
        d="M0 6v-31M0-8l-16-11M1-4l15-14"
        fill="none"
        stroke="#356246"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </g>
  );
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return Math.abs(hash);
}

function palette(seed: string) {
  const hash = hashSeed(seed);
  const outfits = ["#e49a61", "#58b8a3", "#d180a9", "#d7bb55", "#6f9fcb", "#9a7bc0"];
  const accents = ["#f3d59b", "#9edfcf", "#f1b4cf", "#f1dc87", "#afd1ef", "#c9afe1"];
  const hair = ["#34231f", "#5c3e2f", "#202421", "#79543a", "#302b37"];
  return {
    outfit: outfits[hash % outfits.length] ?? outfits[0],
    accent: accents[(hash >>> 4) % accents.length] ?? accents[0],
    hair: hair[(hash >>> 7) % hair.length] ?? hair[0],
    variant: hash % 4,
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
      data-character-variant={colors.variant}
      data-openclaw-primitive="pawn"
      viewBox="-30 -44 60 78"
    >
      <ellipse cx="0" cy="28" rx="18" ry="5" fill="rgb(0 0 0 / 24%)" />
      <g
        className={
          working ? "office-pawn-working" : reviewing ? "office-pawn-reviewing" : "office-pawn-idle"
        }
      >
        <g className="office-pawn-legs">
          <path d="M-13 12h11v15H-13zM2 12h11v15H2z" fill="#293b4d" />
          <path d="M-15 25h15v6h-15zM0 25h15v6H0z" fill="#16211f" />
        </g>
        <path
          d="M-17-8q0-7 7-10h20q7 3 7 10l-2 24h-30z"
          fill={colors.outfit}
          stroke="#362f2a"
          strokeWidth="2.5"
        />
        <path
          d="M-8-17l8 8 8-8"
          fill="none"
          stroke={colors.accent}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M-15-2h30" stroke="#ffffff" strokeOpacity=".13" strokeWidth="2" />
        <g className="office-pawn-arms" strokeLinecap="round">
          <path d="M-16-5l-8 15" stroke={colors.outfit} strokeWidth="8" />
          <path d="M16-5l8 15" stroke={colors.outfit} strokeWidth="8" />
          <circle cx="-24" cy="10" r="4" fill="#d7a67f" />
          <circle cx="24" cy="10" r="4" fill="#d7a67f" />
        </g>
        <rect
          x="-13"
          y="-35"
          width="26"
          height="24"
          rx="10"
          fill="#e1b18a"
          stroke="#46352f"
          strokeWidth="2.5"
        />
        {colors.variant === 0 ? (
          <path d="M-13-30q4-12 13-12t13 12q-7-5-13-5t-13 5" fill={colors.hair} />
        ) : colors.variant === 1 ? (
          <path d="M-14-31q4-12 14-11 10-1 14 11l-5-2-4-7-5 7-6-5-3 6z" fill={colors.hair} />
        ) : colors.variant === 2 ? (
          <path d="M-13-32q2-10 13-10t13 10v5l-6-8-7 3-8-4-5 9z" fill={colors.hair} />
        ) : (
          <path d="M-12-31q4-11 12-11 12 0 14 13l-6-5-4-5-5 6-8-3-3 5z" fill={colors.hair} />
        )}
        <g className="office-pawn-eyes" fill="#2b2927">
          <rect x="-7" y="-26" width="4" height="3" rx="1.5" />
          <rect x="3" y="-26" width="4" height="3" rx="1.5" />
        </g>
        <path
          d="M-3-19q3 2 6 0"
          fill="none"
          stroke="#985c58"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        {colors.variant === 1 ? (
          <g fill="none" stroke="#3b4a46" strokeWidth="1.8">
            <rect x="-10" y="-29" width="8" height="7" rx="3" />
            <rect x="2" y="-29" width="8" height="7" rx="3" />
            <path d="M-2-26h4" />
          </g>
        ) : null}
        {colors.variant === 2 ? (
          <path
            d="M15-29q10 2 9 12"
            fill="none"
            stroke={colors.accent}
            strokeWidth="3"
            strokeLinecap="round"
          />
        ) : null}
        {colors.variant === 3 ? <circle cx="10" cy="1" r="3" fill={colors.accent} /> : null}
      </g>
    </svg>
  );
}
