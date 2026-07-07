import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction } from "@/lib/edge-function-error";
import { withImapSyncMutex } from "@/lib/imap-sync-mutex";

export type ImapSyncProgress = {
  chunkImported: number;
  totalImported: number;
  hasMore: boolean;
};

export type ImapSyncLiveProgress = ImapSyncProgress & {
  phase: "checking" | "new-mail" | "older-mail" | "complete";
  storedInApp: number;
  mailboxTotal?: number;
  progress: number;
  message: string;
};

type ImapSyncPayload = {
  ok?: boolean;
  imported?: number;
  partial?: boolean;
  resume_first_sync?: boolean;
  backfill_has_more?: boolean;
  backfill_seq_to?: number;
  mailbox_total?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

const SKIP_RETRY_MS = 2_000;
const MAX_SKIP_RETRIES = 45;
const OVERLOAD_RETRY_MS = 45_000;
const MAX_OVERLOAD_RETRIES = 3;
/** Hostinger limits concurrent IMAP sessions — pause between chunks. */
const CHUNK_DELAY_MS = 3_000;
const INVOKE_TIMEOUT_MS = 35_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isSyncOverload(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /546|504|compute resources|gateway timeout|timed out after/i.test(msg);
}

async function resetImapSyncLock(supabase: SupabaseClient, accountId: string): Promise<void> {
  await supabase
    .from("email_accounts")
    .update({ sync_status: "idle" })
    .eq("id", accountId)
    .eq("sync_status", "syncing");
}

function imapSyncBody(
  accountId: string,
  extra: Record<string, unknown>,
  manualSync: boolean,
): Record<string, unknown> {
  return {
    account_id: accountId,
    ...(manualSync ? { force_sync: true } : {}),
    ...extra,
  };
}

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
    manualSync?: boolean;
  },
): Promise<{ imported: number; chunks: number }> {
  const maxMessages = options?.maxMessages ?? 25;
  const maxChunks = options?.maxChunks ?? 24;
  const manualSync = options?.manualSync ?? false;

  let totalImported = 0;
  let chunks = 0;
  let resumeFirstSync = false;
  let skipRetries = 0;
  let overloadRetries = 0;

  while (chunks < maxChunks) {
    let data: ImapSyncPayload;
    try {
      data = await withImapSyncMutex(accountId, () =>
        invokeEdgeFunction<ImapSyncPayload>(
          supabase,
          "imap-sync",
          imapSyncBody(accountId, {
            max_messages: maxMessages,
            ...(resumeFirstSync ? { resume_first_sync: true } : {}),
          }, manualSync),
          { timeoutMs: INVOKE_TIMEOUT_MS },
        ),
      );
    } catch (e) {
      if (isSyncOverload(e)) {
        await resetImapSyncLock(supabase, accountId);
        overloadRetries += 1;
        if (overloadRetries > MAX_OVERLOAD_RETRIES) throw e;
        await sleep(OVERLOAD_RETRY_MS);
        continue;
      }
      throw e;
    }
    overloadRetries = 0;

    if (data.skipped) {
      skipRetries += 1;
      if (skipRetries > MAX_SKIP_RETRIES) {
        throw new Error(
          "Another sync is still running for this mailbox. Wait a minute and try again from account settings.",
        );
      }
      await sleep(SKIP_RETRY_MS);
      continue;
    }
    skipRetries = 0;

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
    await sleep(CHUNK_DELAY_MS);
  }

  return { imported: totalImported, chunks };
}

async function countStoredEmails(
  supabase: SupabaseClient,
  accountId: string,
): Promise<number> {
  const { count } = await supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  return count ?? 0;
}

function clampMailboxTotal(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  return n > 0 ? n : undefined;
}

/**
 * Fast path for "Sync now" / foreground — one incremental edge call (~5–20s).
 * Does not run backfill (re-downloading every message in the mailbox).
 */
export async function runImapIncrementalSync(
  supabase: SupabaseClient,
  accountId: string,
  options?: {
    onProgress?: (p: ImapSyncLiveProgress) => void | Promise<void>;
  },
): Promise<{ imported: number; storedInApp: number; mailboxTotal?: number }> {
  const baselineStored = await countStoredEmails(supabase, accountId);

  const emit = async (patch: Partial<ImapSyncLiveProgress>) => {
    await Promise.resolve(options?.onProgress?.({
      phase: "new-mail",
      chunkImported: 0,
      totalImported: patch.totalImported ?? 0,
      hasMore: false,
      storedInApp: patch.storedInApp ?? baselineStored,
      progress: patch.progress ?? 50,
      message: patch.message ?? "Checking for new mail…",
      ...patch,
    }));
  };

  await emit({ progress: 15, message: "Connecting to mailbox…", storedInApp: baselineStored });

  const data = await withImapSyncMutex(accountId, () =>
    invokeEdgeFunction<ImapSyncPayload>(
      supabase,
      "imap-sync",
      imapSyncBody(accountId, { max_messages: 8, incremental_only: true }, true),
      { timeoutMs: 45_000 },
    ),
  );

  const imported = typeof data.imported === "number" ? data.imported : 0;
  const mailboxTotal = clampMailboxTotal(data.mailbox_total);
  const storedInApp = baselineStored + imported;

  await emit({
    phase: "complete",
    totalImported: imported,
    storedInApp,
    mailboxTotal,
    progress: 100,
    message: imported > 0
      ? `Imported ${imported} new message${imported === 1 ? "" : "s"}.`
      : "Inbox is up to date.",
  });

  return { imported, storedInApp, mailboxTotal };
}

/**
 * First connect / deep import: initial chunk + optional backfill for older mail.
 */
function formatStoredProgress(storedInApp: number, mailboxTotal?: number): string {
  if (mailboxTotal && mailboxTotal > 0) {
    return `${storedInApp} of ~${mailboxTotal} message${mailboxTotal === 1 ? "" : "s"}`;
  }
  return `${storedInApp} message${storedInApp === 1 ? "" : "s"}`;
}

export async function runImapFullSync(
  supabase: SupabaseClient,
  accountId: string,
  options?: {
    onProgress?: (p: ImapSyncLiveProgress) => void | Promise<void>;
    maxMessages?: number;
    maxBackfillChunks?: number;
  },
): Promise<{ imported: number; storedInApp: number; mailboxTotal?: number }> {
  const maxMessages = options?.maxMessages ?? 8;
  const maxBackfillChunks = options?.maxBackfillChunks ?? 50;
  const baselineStored = await countStoredEmails(supabase, accountId);

  let totalImported = 0;
  let mailboxTotal: number | undefined;
  let backfillSeqTo: number | undefined;
  let backfillChunks = 0;
  let overloadRetries = 0;
  let maxProgressSeen = 0;

  const resolveStoredInApp = async (patch: Partial<ImapSyncLiveProgress> & { storedInApp?: number }) => {
    if (typeof patch.storedInApp === "number") return patch.storedInApp;
    const live = await countStoredEmails(supabase, accountId);
    return Math.max(live, baselineStored + totalImported, baselineStored);
  };

  const emit = async (
    patch: Partial<ImapSyncLiveProgress> & { backfillSeqTo?: number; storedInApp?: number },
  ) => {
    const storedInApp = await resolveStoredInApp(patch);
    const seqTo = patch.backfillSeqTo ?? backfillSeqTo;
    let progress = 10;
    const total = clampMailboxTotal(mailboxTotal);
    if (total && seqTo !== undefined) {
      progress = Math.min(98, Math.max(5, Math.round(((total - seqTo) / total) * 100)));
    } else if (total) {
      progress = Math.min(98, Math.max(5, Math.round((storedInApp / total) * 100)));
    } else {
      progress = Math.min(92, 10 + backfillChunks * 3);
    }
    if (typeof patch.progress === "number") progress = patch.progress;
    progress = Math.max(maxProgressSeen, progress);
    maxProgressSeen = progress;

    const payload: ImapSyncLiveProgress = {
      phase: patch.phase ?? "checking",
      chunkImported: patch.chunkImported ?? 0,
      totalImported: patch.totalImported ?? totalImported,
      hasMore: patch.hasMore ?? true,
      storedInApp,
      mailboxTotal: total,
      progress,
      message: patch.message ?? "Syncing…",
    };
    await Promise.resolve(options?.onProgress?.(payload));
  };

  if (baselineStored === 0) {
    await emit({ phase: "older-mail", message: "Connecting to your mailbox…", progress: 8 });
    let initial: ImapSyncPayload;
    const connectHeartbeat = window.setInterval(() => {
      void emit({
        phase: "older-mail",
        message: "Connecting to your mailbox…",
        progress: Math.min(28, maxProgressSeen + 2),
      });
    }, 2_500);
    try {
      try {
        initial = await withImapSyncMutex(accountId, () =>
          invokeEdgeFunction<ImapSyncPayload>(
            supabase,
            "imap-sync",
            imapSyncBody(accountId, { max_messages: maxMessages }, true),
            { timeoutMs: INVOKE_TIMEOUT_MS },
          ),
        );
      } catch (e) {
        if (!isSyncOverload(e)) throw e;
        await resetImapSyncLock(supabase, accountId);
        await sleep(OVERLOAD_RETRY_MS);
        initial = await withImapSyncMutex(accountId, () =>
          invokeEdgeFunction<ImapSyncPayload>(
            supabase,
            "imap-sync",
            imapSyncBody(accountId, { max_messages: maxMessages }, true),
            { timeoutMs: INVOKE_TIMEOUT_MS },
          ),
        );
      }
    } finally {
      window.clearInterval(connectHeartbeat);
    }
    if (typeof initial.mailbox_total === "number") mailboxTotal = clampMailboxTotal(initial.mailbox_total);
    const initialImported = typeof initial.imported === "number" ? initial.imported : 0;
    totalImported += initialImported;
    const storedLabel = formatStoredProgress(
      await countStoredEmails(supabase, accountId),
      mailboxTotal,
    );
    await emit({
      phase: initial.partial ? "older-mail" : "complete",
      chunkImported: initialImported,
      hasMore: Boolean(initial.partial),
      progress: initial.partial ? undefined : 100,
      message: initial.partial
        ? `Importing mail · ${storedLabel}…`
        : `Sync complete · ${storedLabel}.`,
    });
    if (!initial.partial) {
      const storedInApp = await countStoredEmails(supabase, accountId);
      return { imported: totalImported, storedInApp, mailboxTotal };
    }
    await sleep(CHUNK_DELAY_MS);
  } else {
    await emit({ phase: "new-mail", message: "Checking for new mail…", progress: 8 });
    try {
      const newMail = await withImapSyncMutex(accountId, () =>
        invokeEdgeFunction<ImapSyncPayload>(
          supabase,
          "imap-sync",
          imapSyncBody(accountId, { max_messages: 4, incremental_only: true }, true),
          { timeoutMs: INVOKE_TIMEOUT_MS },
        ),
      );
      if (typeof newMail.mailbox_total === "number") mailboxTotal = clampMailboxTotal(newMail.mailbox_total);
      const newImported = typeof newMail.imported === "number" ? newMail.imported : 0;
      totalImported += newImported;
      const storedNow = baselineStored + totalImported;
      if (mailboxTotal && storedNow >= mailboxTotal) {
        await emit({
          phase: "complete",
          totalImported,
          storedInApp: storedNow,
          hasMore: false,
          progress: 100,
          message: `Inbox is up to date · ${storedNow} message${storedNow === 1 ? "" : "s"}.`,
        });
        return { imported: totalImported, storedInApp: storedNow, mailboxTotal };
      }
    } catch (e) {
      if (!isSyncOverload(e)) throw e;
      await resetImapSyncLock(supabase, accountId);
      overloadRetries += 1;
      if (overloadRetries > MAX_OVERLOAD_RETRIES) throw e;
      await sleep(OVERLOAD_RETRY_MS);
    }
    await sleep(CHUNK_DELAY_MS);
  }

  await emit({
    phase: "older-mail",
    message: mailboxTotal
      ? `Importing mail · ${formatStoredProgress(await countStoredEmails(supabase, accountId), mailboxTotal)}…`
      : "Importing mail from your mailbox…",
  });

  while (backfillChunks < maxBackfillChunks) {
    let data: ImapSyncPayload;
    try {
      data = await withImapSyncMutex(accountId, () =>
        invokeEdgeFunction<ImapSyncPayload>(
          supabase,
          "imap-sync",
          imapSyncBody(accountId, {
            max_messages: maxMessages,
            backfill_older: true,
            ...(backfillSeqTo !== undefined ? { backfill_seq_to: backfillSeqTo } : {}),
          }, true),
          { timeoutMs: INVOKE_TIMEOUT_MS },
        ),
      );
      overloadRetries = 0;
    } catch (e) {
      if (isSyncOverload(e)) {
        await resetImapSyncLock(supabase, accountId);
        overloadRetries += 1;
        if (overloadRetries > MAX_OVERLOAD_RETRIES) throw e;
        await sleep(OVERLOAD_RETRY_MS);
        continue;
      }
      throw e;
    }

    if (data.skipped) {
      await emit({
        phase: "older-mail",
        message: "Waiting for mailbox — retrying…",
      });
      await sleep(SKIP_RETRY_MS);
      continue;
    }

    backfillChunks += 1;
    if (typeof data.mailbox_total === "number") mailboxTotal = clampMailboxTotal(data.mailbox_total);

    const chunkImported = typeof data.imported === "number" ? data.imported : 0;
    totalImported += chunkImported;
    const hasMore = Boolean(data.partial || data.backfill_has_more);
    if (typeof data.backfill_seq_to === "number") backfillSeqTo = data.backfill_seq_to;

    const storedLabel = formatStoredProgress(
      await countStoredEmails(supabase, accountId),
      mailboxTotal,
    );
    await emit({
      phase: hasMore ? "older-mail" : "complete",
      chunkImported,
      hasMore,
      backfillSeqTo: data.backfill_seq_to,
      message: hasMore
        ? `Importing mail · ${storedLabel}…`
        : `Sync complete · ${storedLabel}.`,
      progress: hasMore ? undefined : 100,
    });

    if (!hasMore) break;
    await sleep(CHUNK_DELAY_MS);
  }

  const storedInApp = await countStoredEmails(supabase, accountId);
  await emit({
    phase: "complete",
    hasMore: false,
    progress: 100,
    message: mailboxTotal
      ? `Done — ${storedInApp} of ~${mailboxTotal} messages in your inbox.`
      : `Done — ${storedInApp} messages imported.`,
  });

  return { imported: totalImported, storedInApp, mailboxTotal };
}
