/**
 * ULTRON's Council-mode face: a procedural 3D wireframe head (no images or models to download), drawn on a canvas.
 * The face is a height field over a grid, masked to a head shape; the jaw opens with the voice level, the eyes glow,
 * and the head drifts and turns slightly so it feels present. Pure functions here; the React wrapper animates it.
 */
export type FaceMood = "idle" | "listening" | "thinking" | "speaking" | "offline" | "error";

const COLS = 30;
const ROWS = 40;
const TOP = 1.05;
const BOTTOM = -1.25;
const g = (v: number, s: number) => Math.exp(-(v * v) / (2 * s * s));
const g2 = (x: number, y: number, sx: number, sy: number) => g(x, sx) * g(y, sy);
const MOUTH_Y = -0.56;

/** Half-width of the face at height y: broad forehead, cheekbones, then the jaw tapering to the chin. */
export function halfWidth(y: number): number {
  if (y >= 0.3) {
    const t = Math.min(1, (y - 0.3) / 0.86);
    return 0.8 * Math.pow(1 - Math.pow(t, 2.5), 1 / 2.5);
  }
  if (y >= -0.42) return 0.8 - 0.05 * ((0.3 - y) / 0.72);
  const t = Math.min(1, (-0.42 - y) / (-0.42 - BOTTOM));
  return 0.75 * (1 - 0.6 * Math.pow(t, 1.7));
}

/** Depth of the face surface at (x, y): brow, eye sockets, nose, cheekbones, lips, chin. */
export function faceDepth(x: number, y: number): number {
  const w = halfWidth(y);
  const u = Math.max(-1, Math.min(1, x / w));
  const ax = Math.abs(x);
  let z = 0.5 * Math.sqrt(Math.max(0, 1 - u * u)) - 0.3 * Math.max(0, y - 0.55) ** 2 - 0.12 * Math.max(0, -0.8 - y) ** 2;
  z += 0.09 * g(y - 0.42, 0.075) * g(ax, 0.5); // brow ridge
  z -= 0.2 * g2(ax - 0.33, y - 0.21, 0.14, 0.09); // eye sockets
  z += 0.035 * g2(ax - 0.33, y - 0.2, 0.07, 0.04); // eyeballs
  const k = (0.36 - y) / 0.7;
  if (y < 0.36 && y > -0.36) z += g(x, 0.045 + 0.08 * k) * (0.06 + 0.24 * k) * Math.min(1, (y + 0.36) / 0.08); // nose bridge rising to the tip
  z += 0.06 * g2(x, y + 0.3, 0.085, 0.06); // nose tip
  z += 0.05 * g2(ax - 0.1, y + 0.34, 0.05, 0.035); // nostrils
  z -= 0.04 * g2(x, y + 0.42, 0.1, 0.03); // under the nose
  z += 0.09 * g2(ax - 0.5, y + 0.02, 0.13, 0.12); // cheekbones
  z -= 0.05 * g2(ax - 0.48, y + 0.36, 0.11, 0.14); // hollow cheeks
  z += 0.11 * g2(x, y + 0.5, 0.19, 0.035); // upper lip
  z += 0.1 * g2(x, y + 0.63, 0.16, 0.04); // lower lip
  z -= 0.04 * g2(x, y + 0.75, 0.14, 0.03); // under the lip
  z += 0.08 * g2(x, y + 0.98, 0.18, 0.1); // chin
  return z;
}

export interface Vertex { x: number; y: number; z: number; nx: number; ny: number; nz: number; jaw: number; edge: boolean }

/** The mesh in face space, computed once. Columns follow the face outline, so the silhouette is smooth. */
export function buildFace(): Vertex[][] {
  const grid: Vertex[][] = [];
  const e = 0.004;
  for (let r = 0; r < ROWS; r++) {
    const y = TOP - ((TOP - BOTTOM) * r) / (ROWS - 1);
    const w = halfWidth(y);
    const row: Vertex[] = [];
    for (let c = 0; c < COLS; c++) {
      const u = -1 + (2 * c) / (COLS - 1);
      const x = u * w * 0.999;
      const z = faceDepth(x, y);
      const dzdx = (faceDepth(x + e, y) - faceDepth(x - e, y)) / (2 * e);
      const dzdy = (faceDepth(x, y + e) - faceDepth(x, y - e)) / (2 * e);
      const len = Math.hypot(dzdx, dzdy, 1);
      // Below the mouth the jaw moves when ULTRON speaks: the lower lip fully, the bottom of the chin a little less.
      // The lips part in an oval: most movement at the centre of the mouth, the rest of the jaw drops a little.
      const lips = Math.max(0, 1 - (x / 0.24) ** 2);
      const jaw = y < MOUTH_Y ? 0.5 + 0.5 * lips * g(y - MOUTH_Y, 0.16) : -0.22 * lips * g(y - MOUTH_Y, 0.05);
      row.push({ x, y, z, nx: -dzdx / len, ny: -dzdy / len, nz: 1 / len, jaw, edge: c === 0 || c === COLS - 1 });
    }
    grid.push(row);
  }
  return grid;
}

export const EYES = [-0.33, 0.33].map((x) => ({ x, y: 0.2, z: faceDepth(x, 0.2) + 0.02 }));

export interface Pose { yaw: number; pitch: number; open: number; scale: number; cx: number; cy: number }

export function project(v: { x: number; y: number; z: number }, p: Pose, jaw = 0): { x: number; y: number; z: number } {
  const y0 = v.y - jaw * p.open * 0.17;
  const z0 = v.z - jaw * p.open * 0.06;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const x1 = v.x * cy + z0 * sy;
  const z1 = -v.x * sy + z0 * cy;
  const y2 = y0 * cp - z1 * sp;
  const z2 = y0 * sp + z1 * cp;
  const persp = 3.4 / (3.4 - z2);
  return { x: p.cx + x1 * p.scale * persp, y: p.cy - y2 * p.scale * persp, z: z2 };
}

const PALETTE: Record<FaceMood, [number, number, number]> = {
  idle: [255, 40, 40],
  listening: [255, 70, 50],
  thinking: [255, 60, 30],
  speaking: [255, 45, 45],
  offline: [120, 40, 40],
  error: [255, 140, 40],
};

/** Draws one frame. `t` in seconds, `level` 0–1 (voice loudness). */
export function drawFace(ctx: CanvasRenderingContext2D, w: number, h: number, mesh: Vertex[][], t: number, mood: FaceMood, level: number, look: { x: number; y: number }) {
  const [r, gr, b] = PALETTE[mood];
  const col = (a: number) => `rgba(${r},${gr},${b},${a})`;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);

  const scale = Math.min(w * 0.28, h * 0.27);
  const pose: Pose = {
    yaw: 0.16 * Math.sin(t * 0.31) + 0.06 * Math.sin(t * 0.83) + look.x * 0.22 + (mood === "thinking" ? 0.08 * Math.sin(t * 2.1) : 0),
    pitch: 0.05 * Math.sin(t * 0.23) + look.y * 0.12 - (mood === "speaking" ? level * 0.05 : 0),
    open: mood === "speaking" ? Math.min(1, level * 1.6) : 0,
    scale,
    cx: w / 2,
    cy: h * 0.38 + Math.sin(t * 0.5) * h * 0.006,
  };

  // Glow behind the head
  const halo = ctx.createRadialGradient(pose.cx, pose.cy, scale * 0.2, pose.cx, pose.cy, scale * 1.6);
  halo.addColorStop(0, col(0.16 + level * 0.12));
  halo.addColorStop(1, col(0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  // HUD rings behind the head, turning slowly (faster while thinking), with tick marks.
  ctx.globalCompositeOperation = "lighter";
  const spin = t * (mood === "thinking" ? 0.9 : 0.12);
  const ring = (r: number, from: number, len: number, width: number, alpha: number) => {
    ctx.beginPath();
    ctx.arc(pose.cx, pose.cy, r, from, from + len);
    ctx.lineWidth = width;
    ctx.strokeStyle = col(alpha);
    ctx.stroke();
  };
  for (let k = 0; k < 4; k++) ring(scale * 1.32, spin + (k * Math.PI) / 2, Math.PI / 3.2, 2, 0.35);
  for (let k = 0; k < 3; k++) ring(scale * 1.42, -spin * 0.7 + (k * 2 * Math.PI) / 3, Math.PI / 5, 5, 0.18 + level * 0.3);
  ctx.lineWidth = 1;
  ctx.strokeStyle = col(0.25);
  ctx.beginPath();
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2 + spin * 0.3;
    const r1 = scale * 1.52;
    const r2 = r1 + (k % 10 === 0 ? 12 : 5);
    ctx.moveTo(pose.cx + Math.cos(a) * r1, pose.cy + Math.sin(a) * r1);
    ctx.lineTo(pose.cx + Math.cos(a) * r2, pose.cy + Math.sin(a) * r2);
  }
  ctx.stroke();
  // Voice waveform under the chin.
  const wy = pose.cy + scale * 1.36;
  ctx.beginPath();
  for (let x = -scale; x <= scale; x += 4) {
    const env = Math.cos((x / scale) * (Math.PI / 2));
    const y = wy + Math.sin(x * 0.06 + t * 9) * Math.sin(x * 0.013 - t * 3) * env * (2 + level * scale * 0.18);
    if (x === -scale) ctx.moveTo(pose.cx + x, y);
    else ctx.lineTo(pose.cx + x, y);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = col(0.35 + level * 0.6);
  ctx.stroke();

  const cyaw = Math.cos(pose.yaw), syaw = Math.sin(pose.yaw), cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
  // Light from the upper left, slightly in front: the shape of the face shows in how bright each line is.
  const L = [-0.5, 0.6, 0.62];
  const ll = Math.hypot(L[0]!, L[1]!, L[2]!);
  const pts = mesh.map((row) =>
    row.map((v) => {
      const p = project(v, pose, v.jaw);
      const nx1 = v.nx * cyaw + v.nz * syaw;
      const nz1 = -v.nx * syaw + v.nz * cyaw;
      const ny2 = v.ny * cp - nz1 * sp;
      const nz2 = v.ny * sp + nz1 * cp;
      const lit = Math.max(0, (nx1 * L[0]! + ny2 * L[1]! + nz2 * L[2]!) / ll);
      return { ...p, v, b: 0.1 + 0.9 * Math.pow(lit, 2.2) };
    }),
  );
  const BUCKETS = 10;
  const paths = Array.from({ length: BUCKETS }, () => new Path2D());
  const outline = new Path2D();
    const add = (a: (typeof pts)[0][0] | undefined, c: (typeof pts)[0][0] | undefined) => {
    if (!a || !c) return;
    // The mouth: lines never cross the lips' parting, so it reads as a mouth (and opens when speaking).
    if (Math.abs(a.v.x) < 0.2 && Math.abs(c.v.x) < 0.2 && (a.v.y - MOUTH_Y) * (c.v.y - MOUTH_Y) < 0) return;
    const k = Math.max(0, Math.min(BUCKETS - 1, Math.floor(((a.b + c.b) / 2) * BUCKETS)));
    const path = a.v.edge && c.v.edge ? outline : paths[k]!;
    path.moveTo(a.x, a.y);
    path.lineTo(c.x, c.y);
  };
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j < pts[i]!.length; j++) {
      const p = pts[i]![j]!;
      add(p, pts[i]![j + 1]);
      add(p, pts[i + 1]?.[j]);
      add(p, pts[i + 1]?.[(i + j) % 2 === 0 ? j + 1 : j - 1]);
    }
  }
  for (let k = 0; k < BUCKETS; k++) {
    const a = 0.05 + Math.pow(k / (BUCKETS - 1), 1.4) * 0.95;
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = col(a * 0.13);
    ctx.stroke(paths[k]!);
    ctx.lineWidth = 1.05;
    ctx.strokeStyle = col(a * (mood === "offline" ? 0.4 : 0.9));
    ctx.stroke(paths[k]!);
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = col(0.18);
  ctx.stroke(outline);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = col(0.85);
  ctx.stroke(outline);
  // Glitch: while thinking, a slice of the face shifts sideways now and then.
  const glitch = mood === "thinking" && Math.sin(t * 13) > 0.93;
  for (let k = 0; k < BUCKETS; k++) {
    const a = 0.12 + (k / (BUCKETS - 1)) * 0.75;
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = col(a * 0.14);
    ctx.stroke(paths[k]!);
    ctx.lineWidth = 1;
    ctx.strokeStyle = col(a * (mood === "offline" ? 0.4 : 0.85));
    ctx.stroke(paths[k]!);
  }
  if (glitch) {
    const y = pose.cy + Math.sin(t * 7) * scale * 0.6;
    const img = ctx.getImageData(0, Math.max(0, y), w, Math.min(h - y, scale * 0.08) | 0);
    ctx.putImageData(img, 12 * Math.sin(t * 31), Math.max(0, y));
  }

  // Eyes: hot white cores with a red flare; brighter while listening, pulsing while thinking.
  const eyePower = mood === "offline" ? 0.2 : mood === "listening" ? 1.25 : mood === "thinking" ? 0.8 + 0.4 * Math.sin(t * 6) : 1 + level * 0.4;
  for (const e of EYES) {
    const p = project(e, pose);
    const rad = scale * 0.085 * eyePower;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    glow.addColorStop(0, `rgba(255,245,235,${0.95 * Math.min(1, eyePower)})`);
    glow.addColorStop(0.18, col(0.8));
    glow.addColorStop(1, col(0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
    // star flare
    ctx.strokeStyle = `rgba(255,220,210,${0.7 * Math.min(1, eyePower)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - rad * 1.15, p.y);
    ctx.lineTo(p.x + rad * 1.15, p.y);
    ctx.moveTo(p.x, p.y - rad * 0.55);
    ctx.lineTo(p.x, p.y + rad * 0.55);
    ctx.stroke();
  }

  // Scan line sweeping down
  ctx.globalCompositeOperation = "source-over";
  const sy = ((t * 0.18) % 1) * h;
  const scan = ctx.createLinearGradient(0, sy - 40, 0, sy);
  scan.addColorStop(0, col(0));
  scan.addColorStop(1, col(0.07));
  ctx.fillStyle = scan;
  ctx.fillRect(0, sy - 40, w, 40);
}
