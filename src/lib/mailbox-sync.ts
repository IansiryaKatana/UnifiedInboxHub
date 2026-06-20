import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAccountRow } from "@/lib/inbox-data";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";
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
      return { ok: false, error: parseEdgeFunctionFailure(data, error) };
    }
    if (data.skipped) return { ok: true, imported: 0 };
    return { ok: true, imported: typeof data.imported === "number" ? data.imported : 0 };
  }

  if (account.provider_type === "imap") {
    try {
      const { imported } = await runImapSyncInChunks(supabase, account.id, {
        maxMessages: foreground ? 25 : 20,
        maxChunks: foreground ? 12 : 6,
      });
      return { ok: true, imported };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { ok: false, error: `Unsupported provider: ${account.provider_type}` };
}
