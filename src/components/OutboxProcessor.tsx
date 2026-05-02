import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { flushOutbox, getOutbox } from "@/lib/outbox-queue";
import { toast } from "sonner";

/** Retries queued edge-function sends when the device is back online. */
export function OutboxProcessor() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!user?.id) return;

    const run = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (getOutbox().length === 0) return;
      if (running.current) return;
      running.current = true;
      try {
        const { sent, failed } = await flushOutbox(supabase);
        if (sent > 0) {
          toast.success(sent === 1 ? "Queued message sent." : `${sent} queued messages sent.`);
          await queryClient.invalidateQueries({ queryKey: ["inbox-threads", user.id] });
          await queryClient.invalidateQueries({ queryKey: ["email-accounts", user.id] });
        }
        if (failed > 0 && sent === 0 && getOutbox().length > 0) {
          /* keep quiet — still failing */
        }
      } finally {
        running.current = false;
      }
    };

    void run();
    const onOnline = () => void run();
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(() => void run(), 45_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, [user?.id, queryClient]);

  return null;
}
