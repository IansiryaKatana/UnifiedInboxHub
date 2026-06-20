// Triggered every 5 minutes by pg_cron. Iterates all email_accounts and invokes the right
// sync function per provider. Authenticated by a shared SYNC_CRON_SECRET header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type ProviderType = "gmail" | "imap";
type AccountRow = { id: string; user_id: string; provider_type: ProviderType };
type SyncResult = {
  id: string;
  provider_type: ProviderType;
  function_name: "gmail-sync" | "imap-sync";
  ok: boolean;
  status?: number;
  timeout: boolean;
  duration_ms: number;
  error?: string;
};

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_TIMEOUT_MS = 55_000;
const MAX_BATCH_SIZE = 20;
const MAX_TIMEOUT_MS = 120_000;

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

type SyncPayload = {
  ok?: boolean;
  error?: string;
  partial?: boolean;
  resume_first_sync?: boolean;
  imported?: number;
  scanned?: number;
  skipped?: boolean;
  reason?: string;
};

async function invokeImapSyncChunked(
  baseUrl: string,
  serviceRoleKey: string,
  acc: AccountRow,
  timeoutMs: number,
): Promise<SyncResult> {
  const startedAt = Date.now();
  const maxChunks = 6;
  let resumeFirstSync = false;
  let totalImported = 0;
  let lastError: string | undefined;
  let lastStatus = 200;

  for (let chunk = 0; chunk < maxChunks; chunk++) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs < 5_000) break;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("timeout"), remainingMs);
    try {
      const res = await fetch(`${baseUrl}/functions/v1/imap-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          "x-internal-cron": "1",
          "x-account-user-id": acc.user_id,
        },
        body: JSON.stringify({
          account_id: acc.id,
          max_messages: 25,
          ...(resumeFirstSync ? { resume_first_sync: true } : {}),
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      let payload: SyncPayload = {};
      try {
        payload = JSON.parse(text) as SyncPayload;
      } catch { /* ignore */ }

      lastStatus = res.status;
      if (!res.ok || payload.ok === false) {
        lastError = payload.error ?? text.slice(0, 300);
        break;
      }
      if (payload.skipped) break;

      totalImported += typeof payload.imported === "number" ? payload.imported : 0;
      resumeFirstSync = Boolean(payload.resume_first_sync);
      if (!payload.partial) break;
    } catch (e) {
      const timedOut = controller.signal.aborted;
      return {
        id: acc.id,
        provider_type: acc.provider_type,
        function_name: "imap-sync",
        ok: false,
        timeout: timedOut,
        duration_ms: Date.now() - startedAt,
        error: timedOut ? `Timed out after ${timeoutMs}ms` : String(e),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    id: acc.id,
    provider_type: acc.provider_type,
    function_name: "imap-sync",
    ok: !lastError,
    status: lastStatus,
    timeout: false,
    duration_ms: Date.now() - startedAt,
    error: lastError ?? (totalImported > 0 ? `imported=${totalImported}` : undefined),
  };
}

async function invokeProviderSync(
  baseUrl: string,
  serviceRoleKey: string,
  acc: AccountRow,
  timeoutMs: number,
): Promise<SyncResult> {
  if (acc.provider_type === "imap") {
    return invokeImapSyncChunked(baseUrl, serviceRoleKey, acc, timeoutMs);
  }

  const fn = "gmail-sync";
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-internal-cron": "1",
        "x-account-user-id": acc.user_id,
      },
      body: JSON.stringify({ account_id: acc.id }),
      signal: controller.signal,
    });
    const text = await res.text();
    let payload: { ok?: boolean; error?: string } = {};
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      // non-json body from downstream function
    }

    const httpOk = res.ok;
    const bodyOk = payload.ok !== false;
    return {
      id: acc.id,
      provider_type: acc.provider_type,
      function_name: fn,
      ok: httpOk && bodyOk,
      status: res.status,
      timeout: false,
      duration_ms: Date.now() - startedAt,
      error: payload.ok === false ? payload.error : (!httpOk ? text.slice(0, 300) : undefined),
    };
  } catch (e) {
    const timedOut = controller.signal.aborted;
    return {
      id: acc.id,
      provider_type: acc.provider_type,
      function_name: fn,
      ok: false,
      timeout: timedOut,
      duration_ms: Date.now() - startedAt,
      error: timedOut ? `Timed out after ${timeoutMs}ms` : String(e),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("SYNC_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const batchSize = readIntEnv("CRON_SYNC_BATCH_SIZE", DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const perAccountTimeoutMs = readIntEnv("CRON_SYNC_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 5_000, MAX_TIMEOUT_MS);

  const supabase = createClient(baseUrl, serviceRoleKey);
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, user_id, provider_type")
    .in("provider_type", ["gmail", "imap"]);

  const typedAccounts = (accounts ?? []) as AccountRow[];
  const results: SyncResult[] = [];

  for (let i = 0; i < typedAccounts.length; i += batchSize) {
    const batch = typedAccounts.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map((acc) => invokeProviderSync(baseUrl, serviceRoleKey, acc, perAccountTimeoutMs)),
    );

    for (const item of settled) {
      if (item.status === "fulfilled") {
        results.push(item.value);
      } else {
        // Defensive fallback; invokeProviderSync already traps most errors.
        results.push({
          id: batch[0]?.id ?? "unknown",
          provider_type: batch[0]?.provider_type ?? "imap",
          function_name: batch[0]?.provider_type === "gmail" ? "gmail-sync" : "imap-sync",
          ok: false,
          timeout: false,
          duration_ms: 0,
          error: String(item.reason),
        });
      }
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const timeoutCount = results.filter((r) => r.timeout).length;
  const failedCount = results.length - okCount;

  return new Response(JSON.stringify({
    ok: true,
    processed: results.length,
    batch_size: batchSize,
    per_account_timeout_ms: perAccountTimeoutMs,
    ok_count: okCount,
    failed_count: failedCount,
    timeout_count: timeoutCount,
    results,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
