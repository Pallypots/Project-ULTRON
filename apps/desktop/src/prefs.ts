import { useEffect, useState } from "react";

export interface UiPrefs {
  highContrast: boolean;
  reducedMotion: boolean;
}

const KEY = "ultron.ui";
const systemReducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as UiPrefs;
  } catch {
    /* storage unavailable */
  }
  return { highContrast: false, reducedMotion: systemReducedMotion() };
}

/** Per-device display preferences, applied as data attributes on <html>. */
export function useUiPrefs(): [UiPrefs, (p: Partial<UiPrefs>) => void] {
  const [prefs, setPrefs] = useState<UiPrefs>(load);
  useEffect(() => {
    document.documentElement.dataset.contrast = prefs.highContrast ? "high" : "normal";
    document.documentElement.dataset.motion = prefs.reducedMotion ? "reduced" : "full";
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);
  return [prefs, (p) => setPrefs((cur) => ({ ...cur, ...p }))];
}
