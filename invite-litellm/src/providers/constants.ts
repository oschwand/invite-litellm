const configuredUrl =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

export const API_URL = configuredUrl.replace(/\/+$/, "");
export const TOKEN_KEY = "litellm_session";
