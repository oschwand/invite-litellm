import type { AuthProvider } from "@refinedev/core";
import { API_URL, TOKEN_KEY } from "./constants";

interface LiteLLMSession {
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

export interface LiteLLMIdentity {
  id: string;
  name: string;
  email: string;
  role: string;
  expiresAt: number;
}

// LiteLLM error bodies vary: {"error": {"message"}}, {"detail": "..."},
// {"detail": {"error": "..."}} — handle all three.
function extractErrorMessage(body: unknown): string | null {
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
function decodeJwtPayload(token: string): Record<string, unknown> | null {
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

function sessionFromToken(token: string): LiteLLMSession | null {
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

function loadSession(): LiteLLMSession | null {
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

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

export const authProvider: AuthProvider = {
  login: async ({ username, email, password }) => {
    const name = username || email;
    if (!name || !password) {
      return {
        success: false,
        error: {
          name: "LoginError",
          message: "Please enter your username and password.",
        },
      };
    }

    try {
      const response = await fetch(`${API_URL}/v2/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, password }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          success: false,
          error: {
            name: "LoginError",
            message:
              extractErrorMessage(body) ??
              `Login failed (HTTP ${response.status}).`,
          },
        };
      }

      const token = (body as { token?: unknown } | null)?.token;
      const session = typeof token === "string" ? sessionFromToken(token) : null;
      if (session === null) {
        clearSession();
        return {
          success: false,
          error: {
            name: "LoginError",
            message:
              "Login succeeded but the session token could not be read.",
          },
        };
      }

      localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: session.token }));
      return { success: true, redirectTo: "/profile" };
    } catch {
      return {
        success: false,
        error: {
          name: "LoginError",
          message: `Could not reach the LiteLLM server at ${API_URL}. Is it running?`,
        },
      };
    }
  },

  logout: async () => {
    clearSession();
    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    // loadSession() already rejects missing/malformed/expired tokens.
    if (loadSession() !== null) {
      return { authenticated: true };
    }
    clearSession();
    return { authenticated: false, logout: true, redirectTo: "/login" };
  },

  getPermissions: async () => loadSession()?.userRole ?? null,

  getIdentity: async () => {
    const session = loadSession();
    if (session === null) return null;
    return {
      id: session.userId,
      name: session.userEmail || session.userId,
      email: session.userEmail,
      role: session.userRole,
      expiresAt: session.expiresAt,
    };
  },

  onError: async (error) => {
    // LiteLLM invalidates session keys unpredictably (e.g. after
    // key-management calls); any 401 means the session is gone.
    const status = (error as { statusCode?: number } | null)?.statusCode;
    if (status === 401) {
      return { logout: true, redirectTo: "/login", error };
    }
    return { error };
  },
};
