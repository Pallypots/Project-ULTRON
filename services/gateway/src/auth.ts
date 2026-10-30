import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/i;
const PUBLIC_API = new Set(["/api/health", "/api/bootstrap"]);

export function loadOrCreateToken(dataDir: string): string {
  const file = join(dataDir, "local-token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const token = randomBytes(32).toString("base64url");
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function isLoopbackRequest(req: FastifyRequest): boolean {
  const host = req.headers.host ?? "";
  const origin = req.headers.origin;
  return LOOPBACK_HOST.test(host) && (!origin || LOOPBACK_ORIGIN.test(origin));
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Every request must target a loopback Host (defeats DNS rebinding) and come from a loopback Origin
 * (defeats other websites calling the local API). Every /api route except health/bootstrap also needs the token.
 */
export function registerAuth(app: FastifyInstance, token: string): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!isLoopbackRequest(req)) {
      return reply.code(403).send({ error: "forbidden", message: "ULTRON only accepts requests from this computer." });
    }
    // Decide by the route Fastify actually matched (its router percent-decodes paths), and by the decoded raw path for
    // unmatched requests, so encodings like /%61pi/... can't slip past the token check.
    let decoded: string;
    try {
      decoded = decodeURIComponent((req.url.split("?")[0] ?? "").toLowerCase());
    } catch {
      return reply.code(400).send({ error: "bad_request", message: "Malformed address." });
    }
    const route = req.routeOptions?.url;
    const isApi = (route ?? "").startsWith("/api/") || decoded.startsWith("/api/") || decoded.startsWith("/api%");
    if (!isApi || (route !== undefined && PUBLIC_API.has(route))) return;
    if (!tokenMatches(req.headers.authorization, token)) {
      return reply.code(401).send({ error: "unauthorized", message: "Missing or invalid ULTRON session token." });
    }
  });
}
