import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmailAccountRow } from "@/lib/inbox-data";
import { isActiveSync, syncEmailAccount } from "@/lib/mailbox-sync";

const POLL_MS_VISIBLE = 15_000;
const MIN_GAP_MS = 10_000;
const IMAP_FAIL_BACKOFF_MS = 90_000;
const GMAIL_FAIL_BACKOFF_MS = 90_000;

function isStaleAccountError(error: string): boolean {
  return /not found|404/i.test(error);
}

function isGmailOverload(error: string): boolean {
  return error.includes("546") || error.includes("504") || error.includes("429") || error.includes("Gateway");
}

/**
 * While the app tab is visible, periodically invokes provider sync so new mail
 * appears quickly (with Realtime + push). Pauses when hidden.
 */
export function useForegroundMailboxSync(
  userId: string | undefined,
  accounts: EmailAccountRow[] | undefined,
  accountIdsKey: string,
) {
  const queryClient = useQueryClient();
  const lastRunRef = useRef(0);
  const accountsRef = useRef(accounts);
  const imapNextAllowedRef = useRef<Record<string, number>>({});
  const gmailNextAllowedRef = useRef<Record<string, number>>({});
  const inFlightRef = useRef(false);
  accountsRef.current = accounts;

  const runSync = useCallback(async (options?: { force?: boolean }) => {
    const list = accountsRef.current;
    if (!userId || !list?.length || inFlightRef.current) return;
    const now = Date.now();
    if (!options?.force && now - lastRunRef.current < MIN_GAP_MS && lastRunRef.current !== 0) return;
    lastRunRef.current = now;
    inFlightRef.current = true;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      inFlightRef.current = false;
      return;
    }

    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    let didSync = false;

    try {
      for (const acc of list) {
        if (isActiveSync(acc)) continue;

        try {
          if (acc.provider_type === "gmail") {
            const notBefore = gmailNextAllowedRef.current[acc.id] ?? 0;
            if (Date.now() < notBefore) continue;
          } else if (acc.provider_type === "imap") {
            const notBefore = imapNextAllowedRef.current[acc.id] ?? 0;
            if (Date.now() < notBefore) continue;
          } else {
            continue;
          }

          const result = await syncEmailAccount(supabase, acc, authHeaders, { foreground: true });
          if (!result.ok) {
            const detail = result.error;
            if (isStaleAccountError(detail)) {
              await queryClient.invalidateQueries({ queryKey: ["email-accounts", userId] });
              continue;
            }
            if (acc.provider_type === "gmail" && isGmailOverload(detail)) {
              gmailNextAllowedRef.current[acc.id] = Date.now() + GMAIL_FAIL_BACKOFF_MS;
            } else if (acc.provider_type === "imap") {
              console.warn(`[imap-sync] ${acc.email_address}:`, detail);
              imapNextAllowedRef.current[acc.id] = Date.now() + IMAP_FAIL_BACKOFF_MS;
            }
            continue;
          }

          if (acc.provider_type === "gmail") delete gmailNextAllowedRef.current[acc.id];
          if (acc.provider_type === "imap") delete imapNextAllowedRef.current[acc.id];
          didSync = true;
        } catch {
          /* surfaced via sync_status / last_sync_error */
        }
      }
    } finally {
      inFlightRef.current = false;
    }

    if (!didSync) return;

    await queryClient.invalidateQueries({ queryKey: ["inbox-threads", userId] });
    await queryClient.invalidateQueries({ queryKey: ["email-accounts", userId] });
  }, [userId, queryClient]);

  useEffect(() => {
    if (!userId || !accountIdsKey) return;

    const tick = (force = false) => {
      if (!force && typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void runSync(force ? { force: true } : undefined);
    };

    lastRunRef.current = 0;
    const bootTimer = window.setTimeout(() => tick(true), 1_500);

    const interval = window.setInterval(() => tick(false), POLL_MS_VISIBLE);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick(true);
    };
    const onOnline = () => tick(true);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      window.clearTimeout(bootTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [userId, accountIdsKey, runSync]);

  return { runSync };
}
