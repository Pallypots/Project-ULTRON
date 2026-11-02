import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../icons.tsx";

/** Shrinks a video frame to at most 1024 px and returns it as base64 JPEG (no "data:" prefix). */
function grab(video: HTMLVideoElement): string {
  const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82).split(",")[1]!;
}

/**
 * "Look at this": a live camera preview; one photo is taken only when the owner clicks, the camera turns off straight
 * after, and the photo goes with that one message (never saved).
 */
export function CameraModal({ onPhoto, onClose }: { onPhoto: (jpegBase64: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let live = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (!live) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((e: Error) => setError(e.name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for ULTRON in the browser's address bar, then try again." : e.name === "NotFoundError" ? "No camera found on this device." : `Couldn't start the camera: ${e.message}`));
    if (!navigator.mediaDevices) setError("This browser can't use a camera here.");
    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Show ULTRON something with the camera">
      <div className="camera__box hud-panel">
        <h2 className="hud-panel__title"><span>VISUAL INPUT</span></h2>
        {error ? <div className="banner banner--error" role="alert">{error}</div> : <video ref={video} autoPlay playsInline muted className="camera__video" />}
        <p className="small muted">One photo goes with your next message, then the camera turns off. Nothing is saved.</p>
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={Boolean(error)} onClick={() => video.current?.videoWidth && onPhoto(grab(video.current))}><Icon name="camera" /> Take photo</button>
          <button type="button" className="btn" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>Switch camera</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
