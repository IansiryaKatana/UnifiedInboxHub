import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmailAccountRow } from "@/lib/inbox-data";

const POLL_MS_VISIBLE = 22_000;
const MIN_GAP_MS = 10_000;

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
  accountsRef.current = accounts;

  const runSync = useCallback(async () => {
    const list = accountsRef.current;
    if (!userId || !list?.length) return;
    const now = Date.now();
    if (now - lastRunRef.current < MIN_GAP_MS && lastRunRef.current !== 0) return;
    lastRunRef.current = now;

    await Promise.allSettled(
      list.map(async (acc) => {
        try {
          if (acc.provider_type === "gmail") {
            const { error } = await supabase.functions.invoke("gmail-sync", {
              body: {
                account_id: acc.id,
                max_pages: 1,
                page_size: 25,
              },
            });
            if (error) throw error;
          } else if (acc.provider_type === "imap") {
            const { error } = await supabase.functions.invoke("imap-sync", {
              body: { account_id: acc.id, max_messages: 80 },
            });
            if (error) throw error;
          }
        } catch {
          /* surfaced via sync_status */
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
