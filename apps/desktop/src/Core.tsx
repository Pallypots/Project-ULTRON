import { useLiveStyle, type LevelSource } from "./voice/live.tsx";
export type CoreState = "idle" | "listening" | "thinking" | "speaking" | "offline" | "error";

const LABEL: Record<CoreState, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Responding",
  offline: "Offline",
  error: "Attention needed",
};

/** ULTRON's original HUD core: segmented rings that react to the assistant's real state. */
export function Core({ state, size = 220, level = 0, levelSource }: { state: CoreState; size?: number; level?: number; levelSource?: LevelSource }) {
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  const ref = useLiveStyle<HTMLDivElement>(levelSource, (el, v) => el.style.setProperty("--level", v.toFixed(2)));
  return (
    <div
      ref={ref}
      className={`core core--${state}`}
      style={{ width: size, height: size, ["--level" as string]: level.toFixed(3) }}
      role="img"
      aria-label={`ULTRON status: ${LABEL[state]}`}
    >
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent-strong)" stopOpacity="0.9" />
            <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" className="core__halo" />
        <g className="core__ticks">
          {ticks.map((i) => (
            <line key={i} x1="100" y1="6" x2="100" y2={i % 5 === 0 ? 16 : 11} transform={`rotate(${i * 6} 100 100)`} />
          ))}
        </g>
        <circle cx="100" cy="100" r="78" className="core__ring core__ring--a" />
        <circle cx="100" cy="100" r="64" className="core__ring core__ring--b" />
        <circle cx="100" cy="100" r="50" className="core__ring core__ring--c" />
        <circle cx="100" cy="100" r="40" fill="url(#coreGlow)" className="core__pulse" />
        <circle cx="100" cy="100" r="44" className="core__level" />
        <polygon points="100,74 122,87 122,113 100,126 78,113 78,87" className="core__hex" />
        <path d="M91 89v13a9 9 0 0 0 18 0V89" className="core__glyph" />
      </svg>
      <span className="core__label">{LABEL[state]}</span>
    </div>
  );
}
