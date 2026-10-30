import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gateway = `http://127.0.0.1:${process.env.ULTRON_PORT ?? 7477}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The gateway checks Host/Origin, so present the proxied requests as loopback.
    proxy: { "/api": { target: gateway, changeOrigin: true, headers: { origin: gateway } } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
