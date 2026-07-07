import type { SupabaseClient } from "@supabase/supabase-js";

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
  if (typeof data === "string") return errorFromJsonString(data);
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
    const ctxObj = ctx as Record<string, unknown>;
    const body = ctxObj.body;
    if (typeof body === "string") {
      const from = errorFromJsonString(body);
      if (from) return from;
    }
    const fromBodyObj = extractFromData(body);
    if (fromBodyObj) return fromBodyObj;
  }
  const details = e.details;
  if (typeof details === "string" && details.trim()) return details.trim();
  return null;
}

async function readResponseBody(error: unknown): Promise<string | null> {
  if (!error || typeof error !== "object") return null;
  const ctx = (error as { context?: unknown }).context;
  if (!(ctx instanceof Response)) return null;
  try {
    return errorFromJsonString(await ctx.text());
  } catch {
    return null;
  }
}

/**
 * Supabase `functions.invoke` often sets a generic error for non-2xx while the real
 * message lives in the JSON body (`{ error: "..." }`) on `data` or in `error.context`.
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

/** Like parseEdgeFunctionFailure but reads `error.context` when it is a fetch Response. */
export async function parseEdgeFunctionFailureAsync(data: unknown, error: unknown): Promise<string> {
  const sync = parseEdgeFunctionFailure(data, error);
  if (!/Request failed \(open DevTools/i.test(sync)) return sync;
  const fromResponse = await readResponseBody(error);
  if (fromResponse) return fromResponse;
  return sync;
}

/** Invoke an edge function and throw with the server JSON `error` field on failure. */
export async function invokeEdgeFunction<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  functionName: string,
  body: Record<string, unknown>,
  options?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 35_000;
  const invokePromise = supabase.functions.invoke(functionName, {
    body,
    headers: options?.headers,
  });

  const { data, error } = await Promise.race([
    invokePromise,
    new Promise<{ data: null; error: Error }>((resolve) => {
      window.setTimeout(
        () => resolve({ data: null, error: new Error(`${functionName} timed out after ${timeoutMs}ms`) }),
        timeoutMs,
      );
    }),
  ]);

  if (error) {
    const detail = await parseEdgeFunctionFailureAsync(data, error);
    throw new Error(detail);
  }

  if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
    throw new Error(extractFromData(data) ?? "Request failed");
  }

  return data as T;
}
