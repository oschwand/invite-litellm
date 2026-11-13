import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

const INVITE_BACKEND_URL =
  process.env.INVITE_BACKEND_URL ?? "http://127.0.0.1:8000";

// In production the Python backend serves this SPA, so the invite page POSTs
// to its own URL and reaches the redemption endpoint same-origin. Under the
// dev server that URL belongs to Vite — forward only the redemption POSTs to
// the backend and leave GETs on the dev server so the SPA route (and HMR)
// keep working.
async function forwardInvitePost(
  req: IncomingMessage,
  res: ServerResponse,
  body: Uint8Array,
): Promise<void> {
  try {
    const upstream = await fetch(`${INVITE_BACKEND_URL}${req.url}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
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

const invitePostProxy = (): Plugin => ({
  name: "invite-post-proxy",
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== "POST" || !req.url?.startsWith("/invite/")) {
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
        void forwardInvitePost(req, res, Buffer.concat(chunks));
      });
    });
  },
});

export default defineConfig({
  plugins: [react(), invitePostProxy()],
});
