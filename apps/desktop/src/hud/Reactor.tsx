import type { CoreState } from "../Core.tsx";

const LABEL: Record<CoreState, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Responding",
  offline: "Offline",
  error: "Attention needed",
};

export interface ReactorCommand { label: string; run: () => void; title: string }

const C = 300;
const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};
/** An annular sector (ring segment) from angle a to b, radii r1 < r2. */
function sector(r1: number, r2: number, a: number, b: number): string {
  const [x1, y1] = polar(r2, a);
  const [x2, y2] = polar(r2, b);
  const [x3, y3] = polar(r1, b);
  const [x4, y4] = polar(r1, a);
  const large = b - a > 180 ? 1 : 0;
  return `M${x1} ${y1}A${r2} ${r2} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 ${large} 0 ${x4} ${y4}Z`;
}
function arc(r: number, a: number, b: number): string {
  const [x1, y1] = polar(r, a);
  const [x2, y2] = polar(r, b);
  return `M${x1} ${y1}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * The command-centre centrepiece: rotating rings, live gauges (CPU and memory), a ring of command buttons and a core
 * that glows with ULTRON's voice and state.
 */
export function Reactor({ state, level = 0, cpu = 0, ram = 0, commands, time }: { state: CoreState; level?: number; cpu?: number; ram?: number; commands: ReactorCommand[]; time: string }) {
  const n = commands.length;
  const seg = 360 / n;
  return (
    <div className={`reactor reactor--${state}`} style={{ ["--level" as string]: level.toFixed(3) }}>
      <svg viewBox="0 0 600 600" role="group" aria-label={`ULTRON status: ${LABEL[state]}`}>
        <defs>
          <radialGradient id="rx-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff3f0" stopOpacity="0.95" />
            <stop offset="22%" stopColor="var(--accent-strong)" stopOpacity="0.85" />
            <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="rx-spin rx-spin--slow">
          {Array.from({ length: 180 }, (_, i) => {
            const [x1, y1] = polar(292, i * 2);
            const [x2, y2] = polar(i % 15 === 0 ? 276 : i % 5 === 0 ? 282 : 286, i * 2);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="rx-tick" />;
          })}
        </g>
        <g className="rx-spin rx-spin--rev">
          <path d={arc(266, 10, 80)} className="rx-arc rx-arc--bold" />
          <path d={arc(266, 130, 160)} className="rx-arc" />
          <path d={arc(266, 200, 290)} className="rx-arc rx-arc--bold" />
          <path d={arc(266, 315, 345)} className="rx-arc" />
        </g>
        {/* Command ring */}
        <g className="rx-commands">
          {commands.map((c, i) => {
            const a = i * seg + 1.2;
            const b = (i + 1) * seg - 1.2;
            const mid = (a + b) / 2;
            const [tx, ty] = polar(226, mid);
            const upright = mid > 90 && mid < 270 ? mid + 180 : mid;
            return (
              <g
                key={c.label}
                className="rx-cmd"
                role="button"
                tabIndex={0}
                aria-label={c.title}
                onClick={c.run}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), c.run())}
              >
                <title>{c.title}</title>
                <path d={sector(205, 248, a, b)} />
                <text x={tx} y={ty} transform={`rotate(${upright} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="central">{c.label}</text>
              </g>
            );
          })}
        </g>
        {/* Live gauges: CPU (outer) and memory (inner) */}
        <circle cx={C} cy={C} r={190} className="rx-track" />
        <path d={arc(190, -135, -135 + 270 * Math.min(1, cpu / 100) + 0.01)} className="rx-gauge rx-gauge--cpu" />
        <circle cx={C} cy={C} r={178} className="rx-track" />
        <path d={arc(178, -135, -135 + 270 * Math.min(1, ram / 100) + 0.01)} className="rx-gauge rx-gauge--ram" />
        <text x={polar(184, 150)[0]} y={polar(184, 150)[1]} className="rx-gauge-label" textAnchor="middle">CPU {cpu}%</text>
        <text x={polar(184, 210)[0]} y={polar(184, 210)[1]} className="rx-gauge-label" textAnchor="middle">MEM {ram}%</text>
        <g className="rx-spin rx-spin--fast">
          <circle cx={C} cy={C} r={160} className="rx-dash" />
        </g>
        <g className="rx-spin rx-spin--rev-slow">
          {Array.from({ length: 24 }, (_, i) => (
            <path key={i} d={sector(140, 150, i * 15 + 2, i * 15 + 11)} className="rx-chevron" />
          ))}
        </g>
        {/* Core */}
        <circle cx={C} cy={C} r={128} fill="url(#rx-core)" className="rx-glow" />
        <g className="rx-emblem">
          <polygon points={`${C},${C + 118} ${C - 102},${C - 59} ${C + 102},${C - 59}`} className="rx-tri" />
          <polygon points={`${C},${C - 118} ${C - 102},${C + 59} ${C + 102},${C + 59}`} className="rx-tri rx-tri--b" />
          <circle cx={C} cy={C} r={60} className="rx-inner" />
        </g>
        <text x={C} y={C + 2} className="rx-time" textAnchor="middle">{time}</text>
        <text x={C} y={C + 22} className="rx-state" textAnchor="middle">{LABEL[state].toUpperCase()}</text>
      </svg>
      <span className="sr-only">{LABEL[state]}</span>
    </div>
  );
}
