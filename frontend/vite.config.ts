import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

const INVITE_BACKEND_URL =
  process.env.INVITE_BACKEND_URL ?? "http://127.0.0.1:8000";

// In production the Python backend serves this SPA, so the invite page
// calls it same-origin: the redemption POST goes to the page's own URL and
// the team-name lookup to GET /invite/{team_id}/{code}/info. Under the dev
// server those URLs belong to Vite — forward them to the backend and leave
// the other GETs on the dev server so the SPA route (and HMR) keep working.
// GET /models joins them, gated on the Authorization header to tell the
// backend's JSON API apart from a navigation to the /models SPA route.
const INVITE_INFO_PATTERN = /^\/invite\/[^/]+\/[^/]+\/info$/;

async function forwardToInviteBackend(
  req: IncomingMessage,
  res: ServerResponse,
  body?: Buffer,
): Promise<void> {
  try {
    const upstream = await fetch(`${INVITE_BACKEND_URL}${req.url}`, {
      method: req.method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(typeof req.headers.authorization === "string"
          ? { authorization: req.headers.authorization }
          : {}),
      },
      body,
    });
    res.statusCode = upstream.status;
    res.setHeader("content-type", "application/json");
    res.end(await upstream.text());
  } catch {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        detail: `Could not reach the invite backend at ${INVITE_BACKEND_URL} — is it running?`,
      }),
    );
  }
}

const inviteProxy = (): Plugin => ({
  name: "invite-proxy",
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const path = req.url?.split("?")[0] ?? "";
      const invitePost =
        req.method === "POST" && path.startsWith("/invite/");
      const inviteInfo =
        req.method === "GET" && INVITE_INFO_PATTERN.test(path);
      // GET /models with an Authorization header is the backend's
      // team-filtered model API; without one it is a browser navigation to
      // the /models SPA route, which must stay on the dev server.
      const modelsApi =
        req.method === "GET" &&
        path === "/models" &&
        typeof req.headers.authorization === "string";
      if (inviteInfo || modelsApi) {
        void forwardToInviteBackend(req, res);
        return;
      }
      if (!invitePost) {
        next();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => {
        chunks.push(chunk);
      });
      req.on("error", () => {
        res.statusCode = 400;
        res.end();
      });
      req.on("end", () => {
        void forwardToInviteBackend(req, res, Buffer.concat(chunks));
      });
    });
  },
});

export default defineConfig({
  plugins: [react(), inviteProxy()],
  server: {
    proxy: {
      // Same-origin GET /config from the Python backend in dev (same setup
      // as the Alpine app's dev server) — runtime LITELLM_URL + version.
      "/config": { target: INVITE_BACKEND_URL, changeOrigin: true },
    },
  },
});
