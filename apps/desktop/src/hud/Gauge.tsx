/** A small ring gauge for the System Monitor panel. */
export function Gauge({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 38;
  const len = 2 * Math.PI * r;
  return (
    <div className="gauge" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="gauge__track" />
        <circle cx="50" cy="50" r={r} className={`gauge__bar ${v > 85 ? "gauge__bar--hot" : ""}`} strokeDasharray={`${(v / 100) * len} ${len}`} transform="rotate(-90 50 50)" />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="gauge__value">{value == null ? "–" : `${Math.round(v)}%`}</text>
      </svg>
      <div className="gauge__label">{label}</div>
      {detail && <div className="gauge__detail">{detail}</div>}
    </div>
  );
}
