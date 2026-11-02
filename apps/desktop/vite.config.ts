import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The interface knows which version it was built from, so it can tell when the service is newer.
const version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

const gateway = `http://127.0.0.1:${process.env.ULTRON_PORT ?? 7477}`;

export default defineConfig({
  plugins: [react()],
  define: { __ULTRON_VERSION__: JSON.stringify(version), __ULTRON_BUILT__: JSON.stringify(new Date().toISOString()) },
  server: {
    port: 5173,
    strictPort: true,
    // The gateway checks Host/Origin, so present the proxied requests as loopback.
    proxy: { "/api": { target: gateway, changeOrigin: true, headers: { origin: gateway } }, "/vendor": { target: gateway, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
