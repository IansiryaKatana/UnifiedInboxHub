import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmailAccountRow } from "@/lib/inbox-data";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";

const POLL_MS_VISIBLE = 22_000;
const MIN_GAP_MS = 10_000;
const IMAP_FAIL_BACKOFF_MS = 3 * 60_000;

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
  accountsRef.current = accounts;

  const runSync = useCallback(async () => {
    const list = accountsRef.current;
    if (!userId || !list?.length) return;
    const now = Date.now();
    if (now - lastRunRef.current < MIN_GAP_MS && lastRunRef.current !== 0) return;
    lastRunRef.current = now;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) return;

    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    await Promise.allSettled(
      list.map(async (acc) => {
        try {
          if (acc.provider_type === "gmail") {
            const { error } = await supabase.functions.invoke("gmail-sync", {
              headers: authHeaders,
              body: {
                account_id: acc.id,
                max_pages: 1,
                page_size: 25,
              },
            });
            if (error) throw error;
          } else if (acc.provider_type === "imap") {
            const notBefore = imapNextAllowedRef.current[acc.id] ?? 0;
            if (Date.now() < notBefore) return;
            const { data, error } = await supabase.functions.invoke("imap-sync", {
              headers: authHeaders,
              body: { account_id: acc.id, max_messages: 80 },
            });
            if (error || (data && typeof data === "object" && (data as { ok?: boolean }).ok === false)) {
              const detail = parseEdgeFunctionFailure(data, error);
              console.warn(`[imap-sync] ${acc.email_address}:`, detail);
              imapNextAllowedRef.current[acc.id] = Date.now() + IMAP_FAIL_BACKOFF_MS;
            } else {
              delete imapNextAllowedRef.current[acc.id];
            }
          }
        } catch {
          /* surfaced via sync_status / last_sync_error */
        }
      }),
    );

    await queryClient.invalidateQueries({ queryKey: ["inbox-threads", userId] });
    await queryClient.invalidateQueries({ queryKey: ["email-accounts", userId] });
  }, [userId, queryClient]);

  useEffect(() => {
    if (!userId || !accountIdsKey) return;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void runSync();
    };

    lastRunRef.current = 0;
    void tick();

    const interval = window.setInterval(tick, POLL_MS_VISIBLE);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    const onOnline = () => void runSync();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [userId, accountIdsKey, runSync]);
}
