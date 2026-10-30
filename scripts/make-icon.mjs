// Renders the ULTRON logo SVG to PNGs and packs them into a Windows .ico (PNG-compressed entries, supported since Vista).
// Usage: node scripts/make-icon.mjs   (needs Playwright's Chromium, like the E2E test)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(import.meta.dirname, "..");
const svg = readFileSync(join(root, "apps/desktop/public/ultron.svg"), "utf8");
const sizes = [16, 32, 48, 256];
const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = [];
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body></html>`);
  pngs.push(await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }));
}
await browser.close();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(join(root, "apps/desktop/public/ultron.ico"), Buffer.concat([header, ...entries, ...pngs]));
writeFileSync(join(root, "apps/desktop/public/ultron-256.png"), pngs.at(-1));
console.log("wrote apps/desktop/public/ultron.ico");
