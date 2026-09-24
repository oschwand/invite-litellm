import type { HttpError } from "@refinedev/core";
import { API_URL } from "./constants";
import { extractErrorMessage, loadSession } from "./session";

export type QueryValue = string | number | boolean | undefined;

interface LitellmOptions {
  method?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export class LiteLLMError extends Error implements HttpError {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function litellmRequest<T>(
  path: string,
  { method = "GET", query, body }: LitellmOptions = {},
): Promise<T> {
  const session = loadSession();
  if (session === null) {
    throw new LiteLLMError("Not signed in — your session has expired.", 401);
  }

  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new LiteLLMError(
      `Could not reach the LiteLLM server at ${API_URL}. Is it running?`,
      0,
    );
  }

  if (!response.ok) {
    const parsed: unknown = await response.json().catch(() => null);
    throw new LiteLLMError(
      extractErrorMessage(parsed) ??
        `LiteLLM request failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  return (await response.json().catch(() => ({}))) as T;
}
