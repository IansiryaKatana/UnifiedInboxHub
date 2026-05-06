function isGenericInvokeMessage(msg: string): boolean {
  return /edge function returned a non-2xx status code|non-2xx status/i.test(msg);
}

function errorFromJsonString(raw: string): string | null {
  try {
    const j = JSON.parse(raw) as { error?: string; message?: string };
    if (typeof j.error === "string" && j.error.trim()) return j.error.trim();
    if (typeof j.message === "string" && j.message.trim()) return j.message.trim();
  } catch {
    /* ignore */
  }
  return null;
}

function extractFromData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as { error?: string; message?: string; ok?: boolean };
  if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
  if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
  return null;
}

function extractFromErrorContext(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  const ctx = e.context;
  if (ctx && typeof ctx === "object") {
    const body = (ctx as Record<string, unknown>).body;
    if (typeof body === "string") {
      const from = errorFromJsonString(body);
      if (from) return from;
    }
  }
  const details = e.details;
  if (typeof details === "string" && details.trim()) return details.trim();
  return null;
}

/**
 * Supabase `functions.invoke` often sets a generic error for non-2xx while the real
 * message lives in the JSON body (`{ error: "..." }`) on `data` or in `error.context.body`.
 */
export function parseEdgeFunctionFailure(data: unknown, error: unknown): string {
  const fromData = extractFromData(data);
  if (fromData) return fromData;

  const fromCtx = extractFromErrorContext(error);
  if (fromCtx) return fromCtx;

  if (error && typeof error === "object") {
    const msg = (error as { message?: string }).message;
    if (typeof msg === "string" && msg.trim() && !isGenericInvokeMessage(msg)) return msg.trim();
  }
  if (error instanceof Error && !isGenericInvokeMessage(error.message)) return error.message;
  return "Request failed (open DevTools → Network → failed request → Response for details).";
}
