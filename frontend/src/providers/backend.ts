import { LiteLLMError, type QueryValue } from "./litellm";
import { extractErrorMessage, loadSession } from "./session";

// Same-origin call to the Python backend (in production it serves this
// SPA; the dev server proxies these paths to it like /config). Carries the
// session's virtual key so the backend can attribute the call to a user.
export async function backendRequest<T>(
  path: string,
  { query }: { query?: Record<string, QueryValue> } = {},
): Promise<T> {
  const session = loadSession();
  if (session === null) {
    throw new LiteLLMError("Not signed in — your session has expired.", 401);
  }

  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${session.apiKey}` },
    });
  } catch {
    throw new LiteLLMError(
      "Could not reach the invite backend — is it running?",
      0,
    );
  }

  if (!response.ok) {
    const parsed: unknown = await response.json().catch(() => null);
    throw new LiteLLMError(
      extractErrorMessage(parsed) ??
        `Backend request failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  return (await response.json().catch(() => ({}))) as T;
}
