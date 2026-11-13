const configuredUrl =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

const defaultApiUrl = configuredUrl.replace(/\/+$/, "");

// Build-time default (VITE_API_URL). The runtime value usually comes from
// the backend's GET /config (see providers/config.ts) — read it through
// getApiUrl(), never through this export, or the two can drift.
export const API_URL = defaultApiUrl;

let runtimeApiUrl: string | null = null;

export function getApiUrl(): string {
  return runtimeApiUrl ?? defaultApiUrl;
}

export function setApiUrl(url: string) {
  runtimeApiUrl = url.replace(/\/+$/, "");
}

export const TOKEN_KEY = "litellm_session";
