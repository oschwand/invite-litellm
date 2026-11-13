export const TOKEN_KEY = "litellm_session";

export interface LiteLLMSession {
  token: string;
  apiKey: string;
  userId: string;
  userEmail: string;
  userRole: string;
  expiresAt: number;
}

interface ErrorBody {
  error?: { message?: string } | string;
  detail?: { message?: string; error?: string } | string;
  message?: string;
}

// LiteLLM error bodies vary: {"error": {"message"}}, {"detail": "..."},
// {"detail": {"error": "..."}} — handle all three.
export function extractErrorMessage(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const data = body as ErrorBody;
  if (typeof data.error === "string") return data.error;
  if (typeof data.error?.message === "string") return data.error.message;
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.detail?.error === "string") return data.detail.error;
  if (typeof data.detail?.message === "string") return data.detail.message;
  if (typeof data.message === "string") return data.message;
  return null;
}

// Decode the session JWT client-side (never verified — HS256-signed with the
// proxy's master key). The `key` claim is the virtual key to use as Bearer.
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const encoded = token.split(".")[1];
  if (encoded === undefined) return null;
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  try {
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function sessionFromToken(token: string): LiteLLMSession | null {
  const payload = decodeJwtPayload(token);
  if (payload === null || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return {
    token,
    apiKey: String(payload.key ?? ""),
    userId: String(payload.user_id ?? "unknown"),
    userEmail: String(payload.user_email ?? ""),
    userRole: String(payload.user_role ?? ""),
    expiresAt: payload.exp,
  };
}

export function loadSession(): LiteLLMSession | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (raw === null) return null;
  try {
    const stored = JSON.parse(raw) as { token?: unknown };
    if (typeof stored.token !== "string") return null;
    return sessionFromToken(stored.token);
  } catch {
    return null;
  }
}

export function saveSession(token: string) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token }));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}
