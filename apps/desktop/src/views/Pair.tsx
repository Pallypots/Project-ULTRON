import { useState } from "react";
import { pairDevice } from "../api.ts";

/** Shown on a phone opening ULTRON over Tailscale for the first time (or after it was removed on the PC). */
export function PairScreen() {
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => (/iphone/i.test(navigator.userAgent) ? "iPhone" : /ipad/i.test(navigator.userAgent) ? "iPad" : /android/i.test(navigator.userAgent) ? "Android phone" : "Phone"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pairDevice(code.trim(), name.trim());
      location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="pair">
      <form className="panel form pair__card" onSubmit={submit}>
        <h1>Pair with ULTRON</h1>
        <p className="muted">
          On your PC, open ULTRON → <strong>Settings → Phone access</strong> and click <strong>Pair a phone</strong>. Type the 6-digit code it shows.
        </p>
        <label className="field">
          <span>Code from your PC</span>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
        </label>
        <label className="field">
          <span>Name for this device</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <button className="btn btn--primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "Pairing…" : "Pair"}</button>
        {error && <div className="banner banner--error" role="alert">{error}</div>}
      </form>
    </main>
  );
}
