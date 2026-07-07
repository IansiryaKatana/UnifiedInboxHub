import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { withMailboxSyncPaused } from "@/lib/mailbox-sync-pause";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";

/** Deletes an account via the account-delete edge function (server-side batched cleanup). */
export async function deleteEmailAccount(
  supabase: SupabaseClient<Database>,
  accountId: string,
): Promise<void> {
  return withMailboxSyncPaused(async () => {
    // #region agent log
    fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "44192d" },
      body: JSON.stringify({
        sessionId: "44192d",
        runId: "post-fix-v5",
        hypothesisId: "H",
        location: "delete-email-account.ts:invoke-start",
        message: "invoking account-delete edge function",
        data: { accountId },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    const { data, error } = await supabase.functions.invoke("account-delete", {
      body: { account_id: accountId },
    });

    const result = data as { ok?: boolean; error?: string; emails_deleted?: number; batches?: number } | null;
    if (error || !result?.ok) {
      const msg = parseEdgeFunctionFailure(data, error);
      // #region agent log
      fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "44192d" },
        body: JSON.stringify({
          sessionId: "44192d",
          runId: "post-fix-v5",
          hypothesisId: "L",
          location: "delete-email-account.ts:invoke-error",
          message: "account-delete failed",
          data: { accountId, errorMessage: error?.message ?? null, resultError: result?.error ?? null, parsed: msg },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      throw new Error(result?.error ?? msg);
    }

    // #region agent log
    fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "44192d" },
      body: JSON.stringify({
        sessionId: "44192d",
        runId: "post-fix-v5",
        hypothesisId: "H",
        location: "delete-email-account.ts:invoke-done",
        message: "account-delete succeeded",
        data: { accountId, ...result },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  });
}
