import type { AuthProvider } from "@refinedev/core";
import { API_URL } from "./constants";
import {
  clearSession,
  extractErrorMessage,
  loadSession,
  saveSession,
  sessionFromToken,
} from "./session";

export interface LiteLLMIdentity {
  id: string;
  name: string;
  email: string;
  role: string;
  expiresAt: number;
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
            message: "Login succeeded but the session token could not be read.",
          },
        };
      }

      saveSession(session.token);
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
