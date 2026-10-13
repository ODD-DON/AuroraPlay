/** Structured JSON logging. Secrets must never be passed in `data`. */

type Level = "debug" | "info" | "warn" | "error";

const REDACT = /(token|secret|password|authorization|api[_-]?key|credential)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  if (process.env.RR_SILENT_LOGS === "1" && level !== "error") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(data ? (redact(data) as object) : {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (e: string, d?: Record<string, unknown>) => emit("debug", e, d),
  info: (e: string, d?: Record<string, unknown>) => emit("info", e, d),
  warn: (e: string, d?: Record<string, unknown>) => emit("warn", e, d),
  error: (e: string, d?: Record<string, unknown>) => emit("error", e, d),
};
