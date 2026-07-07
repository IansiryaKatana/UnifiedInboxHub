import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAccountRow } from "@/lib/inbox-data";
import { invokeEdgeFunction, parseEdgeFunctionFailureAsync } from "@/lib/edge-function-error";
import { withImapSyncMutex } from "@/lib/imap-sync-mutex";
import { runImapSyncInChunks } from "@/lib/imapSyncChunks";

/** Sync older than this is treated as stuck (edge timeout) and can be retried. */
export const STALE_SYNC_MS = 3 * 60_000;

export function isActiveSync(acc: { sync_status: string; updated_at?: string | null }): boolean {
  if (acc.sync_status !== "syncing") return false;
  if (!acc.updated_at) return false;
  return Date.now() - new Date(acc.updated_at).getTime() < STALE_SYNC_MS;
}

export type AccountSyncResult = { ok: true; imported?: number } | { ok: false; error: string };

/** Invokes provider sync for one mailbox account. */
export async function syncEmailAccount(
  supabase: SupabaseClient,
  account: Pick<EmailAccountRow, "id" | "provider_type" | "email_address">,
  authHeaders: { Authorization: string },
  options?: { foreground?: boolean },
): Promise<AccountSyncResult> {
  const foreground = options?.foreground ?? false;

  if (account.provider_type === "gmail") {
    const { data, error } = await supabase.functions.invoke("gmail-sync", {
      headers: authHeaders,
      body: {
        account_id: account.id,
        max_pages: 1,
        page_size: foreground ? 20 : 15,
        max_full_fetches: foreground ? 12 : 8,
        recent_catchup: foreground,
      },
    });
    if (error || !data?.ok) {
      return { ok: false, error: await parseEdgeFunctionFailureAsync(data, error) };
    }
    if (data.skipped) return { ok: true, imported: 0 };
    return { ok: true, imported: typeof data.imported === "number" ? data.imported : 0 };
  }

  if (account.provider_type === "imap") {
    try {
      // Foreground poll (every ~15s): one small incremental chunk — not a multi-chunk backfill.
      if (foreground) {
        const imapStartedAt = Date.now();
        const data = await withImapSyncMutex(account.id, () =>
          invokeEdgeFunction<{ ok?: boolean; skipped?: boolean; imported?: number; reason?: string }>(
            supabase,
            "imap-sync",
            { account_id: account.id, max_messages: 4, incremental_only: true, force_sync: true },
            { headers: authHeaders, timeoutMs: 45_000 },
          ),
        );
        // #region agent log
        fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e779de" },
          body: JSON.stringify({
            sessionId: "e779de",
            runId: "post-fix",
            hypothesisId: "H3",
            location: "mailbox-sync.ts",
            message: "imap_foreground_result",
            data: {
              accountId: account.id,
              email: account.email_address,
              ok: !!data?.ok,
              skipped: !!data?.skipped,
              reason: data?.reason ?? null,
              imported: data?.imported ?? 0,
              durationMs: Date.now() - imapStartedAt,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        if (!data?.ok) {
          return { ok: false, error: "Request failed" };
        }
        if (data.skipped) return { ok: true, imported: 0 };
        return { ok: true, imported: typeof data.imported === "number" ? data.imported : 0 };
      }

      const { imported } = await runImapSyncInChunks(supabase, account.id, {
        maxMessages: 4,
        maxChunks: 6,
      });
      return { ok: true, imported };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { ok: false, error: `Unsupported provider: ${account.provider_type}` };
}
