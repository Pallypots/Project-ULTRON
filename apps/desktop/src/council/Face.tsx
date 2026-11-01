import { useEffect, useRef } from "react";
import { buildFace, drawFace, type FaceMood } from "./face.ts";

/** The animated wireframe face. `level` is read every frame from a ref so speech moves the jaw smoothly. */
export function Face({ mood, level }: { mood: FaceMood; level: { current: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const mesh = buildFace();
    const look = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * -2;
    };
    window.addEventListener("pointermove", onMove);
    let raf = 0;
    let smooth = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const frame = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Smooth the voice level so the jaw doesn't flicker; follow the pointer lazily.
      smooth += (level.current - smooth) * 0.35;
      look.x += (target.x - look.x) * 0.03;
      look.y += (target.y - look.y) * 0.03;
      const t = reduced ? 0 : (performance.now() - t0) / 1000;
      drawFace(ctx, w, h, mesh, t, moodRef.current, smooth, look);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [level]);
  return <canvas ref={ref} className="council__face" role="img" aria-label={`ULTRON's face: ${mood}`} />;
}
