import { setApiUrl } from "./constants";

let appVersion: string | null = null;

export function getAppVersion(): string | null {
  return appVersion;
}

// Same-origin GET /config from the Python backend (proxied to it by
// vite.config.ts in dev). Adopts the backend's runtime LITELLM_URL so one
// configured value reaches both the backend's upstream calls and the
// browser, and picks up the app version for the footer. The build-time
// VITE_API_URL stays the fallback when no backend answers (bare dev server).
export async function loadServerConfig(): Promise<void> {
  try {
    const response = await fetch("/config", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const body: unknown = await response.json().catch(() => null);
    const config = body as { litellm_url?: unknown; version?: unknown } | null;
    const url = config?.litellm_url;
    if (typeof url === "string" && url !== "") setApiUrl(url);
    const version = config?.version;
    if (typeof version === "string" && version !== "") appVersion = version;
  } catch {
    // No backend answering — keep the build-time fallback.
  }
}
