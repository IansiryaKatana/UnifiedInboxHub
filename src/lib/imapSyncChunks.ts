import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";

export type ImapSyncProgress = {
  chunkImported: number;
  totalImported: number;
  hasMore: boolean;
};

/**
 * Runs imap-sync in short edge-function chunks to avoid relay timeouts (HTTP 546/503).
 * Each chunk imports up to maxMessages, then returns partial=true if more remain.
 */
export async function runImapSyncInChunks(
  supabase: SupabaseClient,
  accountId: string,
  options?: {
    onProgress?: (p: ImapSyncProgress) => void | Promise<void>;
    maxMessages?: number;
    maxChunks?: number;
  },
): Promise<{ imported: number; chunks: number }> {
  const maxMessages = options?.maxMessages ?? 25;
  const maxChunks = options?.maxChunks ?? 24;

  let totalImported = 0;
  let chunks = 0;
  let resumeFirstSync = false;

  while (chunks < maxChunks) {
    const { data, error } = await supabase.functions.invoke("imap-sync", {
      body: {
        account_id: accountId,
        max_messages: maxMessages,
        ...(resumeFirstSync ? { resume_first_sync: true } : {}),
      },
    });

    if (error) {
      throw new Error(parseEdgeFunctionFailure(data, error));
    }
    if (!data?.ok) {
      throw new Error(parseEdgeFunctionFailure(data, error) || "IMAP sync failed");
    }

    chunks += 1;
    const chunkImported = typeof data.imported === "number" ? data.imported : 0;
    totalImported += chunkImported;
    const hasMore = Boolean(data.partial);
    resumeFirstSync = Boolean(data.resume_first_sync);

    await Promise.resolve(options?.onProgress?.({
      chunkImported,
      totalImported,
      hasMore,
    }));

    if (!hasMore) break;
  }

  return { imported: totalImported, chunks };
}
