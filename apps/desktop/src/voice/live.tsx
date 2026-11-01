import { useEffect, useRef } from "react";

/** A value that changes many times a second (a microphone or voice level), read on demand. */
export type LevelSource = () => number;

/**
 * Animates an element straight from a live level, at most once per screen frame, without re-rendering React.
 * (Updating React state 50–60 times a second re-rendered the whole chat and made the app feel laggy.)
 */
export function useLiveStyle<T extends HTMLElement>(source: LevelSource | undefined, apply: (el: T, v: number) => void) {
  const ref = useRef<T>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!source) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const v = Math.round(source() * 100) / 100;
      if (v !== last && ref.current) applyRef.current(ref.current, v);
      last = v;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source]);
  return ref;
}

/** The small level bar in the listening strip. */
export function LiveMeter({ source }: { source: LevelSource }) {
  const ref = useLiveStyle<HTMLElement>(source, (el, v) => (el.style.transform = `scaleX(${Math.max(0.02, v)})`));
  return (
    <span className="listening__meter" aria-hidden="true">
      <i ref={ref} style={{ transform: "scaleX(0.02)" }} />
    </span>
  );
}
