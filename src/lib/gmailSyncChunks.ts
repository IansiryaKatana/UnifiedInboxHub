import type { SupabaseClient } from "@supabase/supabase-js";

export type GmailSyncProgress = {
  chunkImported: number;
  totalImported: number;
  hasMore: boolean;
};

/**
 * Runs gmail-sync in short edge-function chunks to avoid relay timeouts (HTTP 546).
 * Each chunk lists + imports a few inbox pages server-side, then returns next_page_token.
 */
export async function runGmailSyncInChunks(
  supabase: SupabaseClient,
  accountId: string,
  options?: {
    onProgress?: (p: GmailSyncProgress) => void | Promise<void>;
    pageSize?: number;
    maxPagesPerChunk?: number;
  },
): Promise<{ imported: number; chunks: number }> {
  const pageSize = options?.pageSize ?? 20;
  const maxPagesPerChunk = options?.maxPagesPerChunk ?? 1;

  let nextPageToken: string | null = null;
  let totalImported = 0;
  let chunks = 0;

  while (true) {
    const { data, error } = await supabase.functions.invoke("gmail-sync", {
      body: {
        account_id: accountId,
        page_size: pageSize,
        max_pages: maxPagesPerChunk,
        start_page_token: nextPageToken ?? undefined,
      },
    });

    if (error || !data?.ok) {
      throw new Error(error?.message ?? data?.error ?? "Gmail sync failed");
    }

    chunks += 1;
    const chunkImported = typeof data.imported === "number" ? data.imported : 0;
    totalImported += chunkImported;
    nextPageToken = typeof data.next_page_token === "string" && data.next_page_token.length > 0
      ? data.next_page_token
      : null;

    const hasMore = Boolean(nextPageToken);

    await Promise.resolve(options?.onProgress?.({
      chunkImported,
      totalImported,
      hasMore,
    }));

    if (!hasMore) break;
  }

  return { imported: totalImported, chunks };
}
