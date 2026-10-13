import { logger } from "@/server/log";

export class IntegrationError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status: number | null = null,
    public retryable = false,
  ) {
    super(message);
  }
}

/** fetch with timeout and bounded exponential backoff on retryable failures (429, 5xx, network). */
export async function fetchWithRetry(provider: string, url: string, init: RequestInit, opts: { retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      lastErr = new IntegrationError(provider, `${provider} returned ${res.status}: ${body.slice(0, 300)}`, res.status, retryable);
      if (!retryable) throw lastErr;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof IntegrationError && !e.retryable) throw e;
      lastErr = e instanceof IntegrationError ? e : new IntegrationError(provider, `${provider} request failed: ${(e as Error).message}`, null, true);
    }
    if (attempt < retries) {
      const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      logger.warn("integration.retry", { provider, attempt: attempt + 1, delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
