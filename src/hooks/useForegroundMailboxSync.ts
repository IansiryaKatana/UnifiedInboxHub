import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmailAccountRow } from "@/lib/inbox-data";
import { isActiveSync, syncEmailAccount } from "@/lib/mailbox-sync";
import { isMailboxSyncPaused } from "@/lib/mailbox-sync-pause";

/** Active account poll — must exceed typical IMAP sync duration (~4–6s) to avoid session storms. */
const POLL_MS_PRIORITY = 7_000;
const POLL_MS_ALL = 45_000;
const MIN_GAP_MS = 10_000;
const PRIORITY_GAP_MS = 2_500;
/** Gmail foreground sync is ~15–20s — don't re-trigger every poll tick. */
const GMAIL_FOREGROUND_GAP_MS = 30_000;
/** IMAP incremental: Hostinger closes duplicate sessions — gap must exceed sync wall time. */
const IMAP_FOREGROUND_GAP_MS = 6_500;
/** After send: hammer IMAP for replies (Hostinger has no push webhook). */
const BURST_INTERVAL_MS = 2_000;
const BURST_DURATION_MS = 30_000;
const IMAP_FAIL_BACKOFF_MS = 90_000;
const GMAIL_FAIL_BACKOFF_MS = 90_000;
/** Persistent error accounts — probe infrequently (DB sync_status=error). */
const IMAP_CONNECT_PROBE_MS = 15 * 60_000;
/** Transient "too many sessions" — retry soon; 15min probe was silencing auto-poll (logs H1). */
const IMAP_CONNECT_FOREGROUND_BACKOFF_MS = 45_000;

function isStaleAccountError(error: string): boolean {
  return /not found|404/i.test(error);
}

function isSyncOverload(error: string): boolean {
  return error.includes("546") || error.includes("504") || error.includes("429") || error.includes("Gateway") || error.includes("compute resources");
}

function isImapConnectError(error: string): boolean {
  return /imap connect failed|unexpected close|authentication failed|invalid credentials|connection not available/i.test(error);
}

function shouldProbeConnectError(acc: EmailAccountRow): boolean {
  if (acc.sync_status !== "error") return false;
  const err = acc.last_sync_error ?? "";
  if (!isImapConnectError(err)) return false;
  return true;
}

function minGapForProvider(providerType: string): number {
  if (providerType === "gmail") return GMAIL_FOREGROUND_GAP_MS;
  if (providerType === "imap") return IMAP_FOREGROUND_GAP_MS;
  return PRIORITY_GAP_MS;
}

type RunSyncOptions = {
  force?: boolean;
  /** After send — rapid IMAP reply checks, bypass provider gap. */
  burst?: boolean;
  /** User clicked "Check for new mail" — bypass provider gap. */
  userInitiated?: boolean;
  accountId?: string | null;
};

function shouldApplyProviderGap(options?: RunSyncOptions): boolean {
  if (options?.burst) return false;
  if (options?.userInitiated) return false;
  return true;
}

// #region agent log
function dbgSync(hypothesisId: string, message: string, data: Record<string, unknown>) {
  fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e779de" },
    body: JSON.stringify({
      sessionId: "e779de",
      runId: "post-fix",
      hypothesisId,
      location: "useForegroundMailboxSync.ts",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

/**
 * While the app tab is visible, periodically invokes provider sync so new mail
 * appears quickly (with Realtime + push). Pauses when hidden.
 *
 * Inbound latency: IMAP providers (e.g. Hostinger) have no webhook — mail only
 * appears after imap-sync polls. Outbound is instant (smtp-send/gmail-send insert
 * rows). For true push inbound, use Resend inbound parse, Cloudflare Email Workers,
 * or a long-lived IMAP IDLE worker (not feasible on Supabase edge timeouts).
 */
export function useForegroundMailboxSync(
  userId: string | undefined,
  accounts: EmailAccountRow[] | undefined,
  accountIdsKey: string,
  priorityAccountId?: string | null,
) {
  const queryClient = useQueryClient();
  const lastRunRef = useRef(0);
  const lastRunByAccountRef = useRef<Record<string, number>>({});
  const accountsRef = useRef(accounts);
  const priorityAccountIdRef = useRef(priorityAccountId);
  const imapNextAllowedRef = useRef<Record<string, number>>({});
  const gmailNextAllowedRef = useRef<Record<string, number>>({});
  const imapConnectProbeRef = useRef<Record<string, number>>({});
  /** One sync per account at a time (IMAP + Gmail — prevents 20s overlap storms). */
  const accountInFlightRef = useRef<Set<string>>(new Set());
  const pendingForceByAccountRef = useRef<Map<string, RunSyncOptions>>(new Map());
  const fullSyncInFlightRef = useRef(false);
  const rotatePollIndexRef = useRef(0);
  const lastForcedAllRef = useRef(0);
  const burstTimersRef = useRef<number[]>([]);
  const [syncing, setSyncing] = useState(false);
  accountsRef.current = accounts;
  priorityAccountIdRef.current = priorityAccountId;

  /** Round-robin IMAP mailboxes on "All inboxes" so Hostinger still gets ~3s checks. */
  const pickRotatePollAccountId = useCallback((): string | null => {
    if (priorityAccountIdRef.current) return priorityAccountIdRef.current;
    const list = accountsRef.current;
    if (!list?.length) return null;
    if (list.length === 1) return list[0].id;
    const imapAccounts = list.filter((a) => a.provider_type === "imap");
    const pool = imapAccounts.length > 0 ? imapAccounts : list;
    const idx = rotatePollIndexRef.current % pool.length;
    rotatePollIndexRef.current = (idx + 1) % pool.length;
    return pool[idx].id;
  }, []);

  const sortSyncTargets = useCallback((rows: EmailAccountRow[]) => {
    return [...rows].sort((a, b) => {
      const rank = (p: string) => (p === "imap" ? 0 : p === "gmail" ? 1 : 2);
      return rank(a.provider_type) - rank(b.provider_type);
    });
  }, []);

  const queuePendingSync = useCallback((accountId: string, opts: RunSyncOptions) => {
    const existing = pendingForceByAccountRef.current.get(accountId);
    if (!existing) {
      pendingForceByAccountRef.current.set(accountId, opts);
      return;
    }
    if (opts.burst && !existing.burst) {
      pendingForceByAccountRef.current.set(accountId, { ...existing, burst: true, force: true });
    } else if (opts.userInitiated && !existing.userInitiated) {
      pendingForceByAccountRef.current.set(accountId, {
        force: true,
        burst: opts.burst ?? existing.burst,
        userInitiated: true,
      });
    }
  }, []);

  const runSync = useCallback(async (options?: RunSyncOptions) => {
    const syncStartedAt = Date.now();
    const list = accountsRef.current;
    let singleAccount = options?.accountId ?? undefined;
    if (!singleAccount && list?.length === 1) {
      singleAccount = list[0].id;
    }
    const activeList = list?.filter((a) => a.sync_status !== "disconnected") ?? [];
    // #region agent log
    dbgSync("H4", "runSync_start", {
      force: !!options?.force,
      burst: !!options?.burst,
      userInitiated: !!options?.userInitiated,
      accountId: singleAccount ?? null,
      accountCount: list?.length ?? 0,
      activeCount: activeList.length,
      accounts: activeList.map((a) => ({ id: a.id, email: a.email_address, provider: a.provider_type })),
      inFlight: [...accountInFlightRef.current],
    });
    // #endregion
    if (!userId || !list?.length || isMailboxSyncPaused()) {
      // #region agent log
      dbgSync("H1", "runSync_skip", { reason: "no_user_or_paused", durationMs: Date.now() - syncStartedAt });
      // #endregion
      return { imported: 0, syncedAccounts: 0 };
    }
    if (!activeList.length) {
      // #region agent log
      dbgSync("H1", "runSync_skip", { reason: "all_disconnected", durationMs: Date.now() - syncStartedAt });
      // #endregion
      return { imported: 0, syncedAccounts: 0 };
    }
    if (!singleAccount && fullSyncInFlightRef.current) {
      // #region agent log
      dbgSync("H5", "runSync_skip", { reason: "full_sync_in_flight", durationMs: Date.now() - syncStartedAt });
      // #endregion
      return { imported: 0, syncedAccounts: 0 };
    }
    if (singleAccount && accountInFlightRef.current.has(singleAccount)) {
      if (options?.force) {
        queuePendingSync(singleAccount, {
          force: true,
          burst: options.burst,
          userInitiated: options.userInitiated,
          accountId: singleAccount,
        });
        // #region agent log
        dbgSync("H5", "runSync_skip", { reason: "force_queued", accountId: singleAccount, durationMs: Date.now() - syncStartedAt });
        // #endregion
        return { imported: 0, syncedAccounts: 0 };
      }
      // #region agent log
      dbgSync("H5", "runSync_skip", { reason: "account_in_flight", accountId: singleAccount, durationMs: Date.now() - syncStartedAt });
      // #endregion
      return { imported: 0, syncedAccounts: 0 };
    }

    const targets = singleAccount
      ? activeList.filter((a) => a.id === singleAccount)
      : sortSyncTargets(activeList);
    if (!targets.length) return { imported: 0, syncedAccounts: 0 };

    const now = Date.now();
    if (shouldApplyProviderGap(options)) {
      if (singleAccount) {
        const acc = list.find((a) => a.id === singleAccount);
        const gapMs = acc ? minGapForProvider(acc.provider_type) : PRIORITY_GAP_MS;
        const last = lastRunByAccountRef.current[singleAccount] ?? 0;
        if (now - last < gapMs && last !== 0) {
          // #region agent log
          dbgSync("H2", "runSync_skip", {
            reason: "provider_gap",
            accountId: singleAccount,
            provider: acc?.provider_type ?? null,
            gapMs,
            elapsedMs: now - last,
            durationMs: Date.now() - syncStartedAt,
          });
          // #endregion
          return { imported: 0, syncedAccounts: 0 };
        }
      } else if (now - lastRunRef.current < MIN_GAP_MS && lastRunRef.current !== 0) {
        // #region agent log
        dbgSync("H5", "runSync_skip", { reason: "min_gap", elapsedMs: now - lastRunRef.current, durationMs: Date.now() - syncStartedAt });
        // #endregion
        return { imported: 0, syncedAccounts: 0 };
      }
    }

    if (!singleAccount) {
      lastRunRef.current = now;
      fullSyncInFlightRef.current = true;
      setSyncing(true);
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      if (!singleAccount) {
        fullSyncInFlightRef.current = false;
        setSyncing(false);
      }
      return { imported: 0, syncedAccounts: 0 };
    }

    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    let didSync = false;
    let totalImported = 0;
    let syncedAccounts = 0;

    try {
      for (const acc of targets) {
        if (!options?.force && isActiveSync(acc)) {
          // #region agent log
          dbgSync("H1", "account_skip", { reason: "isActiveSync", accountId: acc.id, email: acc.email_address, syncStatus: acc.sync_status });
          // #endregion
          continue;
        }

        try {
          if (acc.provider_type === "gmail") {
            if (!options?.force) {
              const notBefore = gmailNextAllowedRef.current[acc.id] ?? 0;
              if (Date.now() < notBefore) {
                // #region agent log
                dbgSync("H1", "account_skip", { reason: "gmail_backoff", accountId: acc.id, remainingMs: notBefore - Date.now() });
                // #endregion
                continue;
              }
            }
          } else if (acc.provider_type === "imap") {
            if (!options?.force) {
              if (shouldProbeConnectError(acc)) {
                const probeAfter = imapConnectProbeRef.current[acc.id] ?? 0;
                if (Date.now() < probeAfter) {
                  // #region agent log
                  dbgSync("H1", "account_skip", { reason: "imap_probe", accountId: acc.id, remainingMs: probeAfter - Date.now() });
                  // #endregion
                  continue;
                }
                imapConnectProbeRef.current[acc.id] = Date.now() + IMAP_CONNECT_PROBE_MS;
              } else {
                const notBefore = imapNextAllowedRef.current[acc.id] ?? 0;
                if (Date.now() < notBefore) {
                  // #region agent log
                  dbgSync("H1", "account_skip", { reason: "imap_backoff", accountId: acc.id, remainingMs: notBefore - Date.now(), lastError: acc.last_sync_error ?? null });
                  // #endregion
                  continue;
                }
              }
            }
          } else {
            continue;
          }

          if (accountInFlightRef.current.has(acc.id)) continue;

          accountInFlightRef.current.add(acc.id);
          const accountSyncStartedAt = Date.now();
          let result: Awaited<ReturnType<typeof syncEmailAccount>>;
          try {
            result = await syncEmailAccount(supabase, acc, authHeaders, { foreground: true });
          } finally {
            accountInFlightRef.current.delete(acc.id);
            lastRunByAccountRef.current[acc.id] = Date.now();
            const pending = pendingForceByAccountRef.current.get(acc.id);
            if (pending) {
              pendingForceByAccountRef.current.delete(acc.id);
              queueMicrotask(() => {
                void runSync({ ...pending, accountId: acc.id });
              });
            }
          }
          // #region agent log
          dbgSync("H2-H3", "account_sync_done", {
            accountId: acc.id,
            email: acc.email_address,
            provider: acc.provider_type,
            ok: result.ok,
            imported: result.ok ? result.imported ?? 0 : 0,
            error: result.ok ? null : result.error,
            syncMs: Date.now() - accountSyncStartedAt,
          });
          // #endregion

          if (!result.ok) {
            const detail = result.error;
            if (isStaleAccountError(detail)) {
              await queryClient.invalidateQueries({ queryKey: ["email-accounts", userId] });
              continue;
            }
            if (!options?.force) {
              if (acc.provider_type === "gmail" && isSyncOverload(detail)) {
                gmailNextAllowedRef.current[acc.id] = Date.now() + GMAIL_FAIL_BACKOFF_MS;
              } else if (acc.provider_type === "imap") {
                if (isSyncOverload(detail)) {
                  imapNextAllowedRef.current[acc.id] = Date.now() + IMAP_FAIL_BACKOFF_MS;
                } else if (isImapConnectError(detail)) {
                  imapNextAllowedRef.current[acc.id] = Date.now() + IMAP_CONNECT_FOREGROUND_BACKOFF_MS;
                } else {
                  imapNextAllowedRef.current[acc.id] = Date.now() + IMAP_FAIL_BACKOFF_MS;
                }
              }
            }
            continue;
          }

          syncedAccounts += 1;
          totalImported += result.imported ?? 0;
          if (acc.provider_type === "gmail") delete gmailNextAllowedRef.current[acc.id];
          if (acc.provider_type === "imap") {
            delete imapNextAllowedRef.current[acc.id];
            delete imapConnectProbeRef.current[acc.id];
            if (acc.sync_status === "error") {
              await supabase
                .from("email_accounts")
                .update({ sync_status: "idle", last_sync_error: null })
                .eq("id", acc.id);
            }
          }
          didSync = true;
        } catch {
          accountInFlightRef.current.delete(acc.id);
        }
      }
    } finally {
      if (!singleAccount) {
        fullSyncInFlightRef.current = false;
        setSyncing(false);
      }
    }

    if (didSync || options?.force) {
      await queryClient.invalidateQueries({ queryKey: ["inbox-threads", userId] });
      await queryClient.invalidateQueries({ queryKey: ["email-accounts", userId] });
    }

    // #region agent log
    dbgSync("H2-H4", "runSync_end", {
      accountId: singleAccount ?? null,
      syncedAccounts,
      totalImported,
      durationMs: Date.now() - syncStartedAt,
      didSync,
    });
    // #endregion

    return { imported: totalImported, syncedAccounts };
  }, [userId, queryClient, sortSyncTargets, queuePendingSync]);

  const scheduleInboundChecks = useCallback((accountId: string) => {
    for (const id of burstTimersRef.current) window.clearTimeout(id);
    burstTimersRef.current = [];

    void runSync({ force: true, burst: true, accountId });

    const burstCount = Math.floor(BURST_DURATION_MS / BURST_INTERVAL_MS);
    for (let i = 1; i <= burstCount; i++) {
      const id = window.setTimeout(() => {
        void runSync({ force: true, burst: true, accountId });
      }, i * BURST_INTERVAL_MS);
      burstTimersRef.current.push(id);
    }

    for (const ms of [45_000, 90_000]) {
      const id = window.setTimeout(() => {
        void runSync({ force: true, burst: true, accountId });
      }, ms);
      burstTimersRef.current.push(id);
    }
  }, [runSync]);

  useEffect(() => {
    if (!userId || !accountIdsKey) return;

    const tickPriority = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const pri = pickRotatePollAccountId();
      if (pri && accountInFlightRef.current.has(pri)) return;
      const priAcc = pri ? accountsRef.current?.find((a) => a.id === pri) : undefined;
      // #region agent log
      dbgSync("H4", "priority_tick", {
        resolvedAccountId: pri ?? null,
        provider: priAcc?.provider_type ?? null,
        email: priAcc?.email_address ?? null,
        accountCount: accountsRef.current?.length ?? 0,
        inFlight: [...accountInFlightRef.current],
      });
      // #endregion
      if (pri) void runSync({ accountId: pri });
    };

    const tickAll = (force = false) => {
      if (!force && typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (force) {
        const now = Date.now();
        if (now - lastForcedAllRef.current < 8_000) return;
        lastForcedAllRef.current = now;
      }
      const list = accountsRef.current;
      if (list?.length === 1) {
        const soleId = list[0].id;
        if (!force && accountInFlightRef.current.has(soleId)) return;
        void runSync(
          force
            ? { force: true, accountId: soleId }
            : { accountId: soleId },
        );
        return;
      }
      if (!force && accountInFlightRef.current.size > 0) return;
      void runSync(force ? { force: true } : undefined);
    };

    lastRunRef.current = 0;
    const bootTimer = window.setTimeout(() => tickPriority(), 2_000);

    const priorityInterval = window.setInterval(tickPriority, POLL_MS_PRIORITY);
    const allInterval = window.setInterval(() => tickAll(false), POLL_MS_ALL);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tickPriority();
        tickAll(true);
      }
    };
    const onOnline = () => {
      tickPriority();
      tickAll(true);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      window.clearTimeout(bootTimer);
      window.clearInterval(priorityInterval);
      window.clearInterval(allInterval);
      for (const id of burstTimersRef.current) window.clearTimeout(id);
      burstTimersRef.current = [];
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [userId, accountIdsKey, runSync, pickRotatePollAccountId]);

  return { runSync, syncing, scheduleInboundChecks };
}
