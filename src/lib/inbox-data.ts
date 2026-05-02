import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ThreadRow } from "@/components/inbox/ThreadList";

export interface EmailAccountRow {
  id: string;
  email_address: string;
  display_name: string | null;
  color: string;
  sync_status: string;
  provider_type: string;
  last_sync_error?: string | null;
}

type EmailRow = {
  thread_id: string | null;
  sender: string;
  sender_name: string | null;
  sent_at: string;
  direction: string;
  is_starred: boolean;
};

export async function fetchEmailAccounts(userId: string): Promise<EmailAccountRow[]> {
  const { data, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EmailAccountRow[];
}

/** Loads threads + latest sender / starred / sent flags (same logic as legacy loadThreads). */
export async function fetchEnrichedThreads(
  userId: string,
  accountsById: Record<string, EmailAccountRow>,
): Promise<ThreadRow[]> {
  const pageSize = 1000;
  let from = 0;
  let keepLoading = true;
  const allThreads: Record<string, unknown>[] = [];

  while (keepLoading) {
    const { data: batch, error: batchError } = await supabase
      .from("email_threads")
      .select("*")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (batchError) {
      toast.error(batchError.message);
      throw batchError;
    }

    allThreads.push(...(batch ?? []));
    if (!batch || batch.length < pageSize) {
      keepLoading = false;
    } else {
      from += pageSize;
    }
  }

  const threadIds = allThreads.map((t) => t.id as string).filter(Boolean);
  const latestEmailRows: EmailRow[] = [];
  const chunkSize = 80;

  if (threadIds.length > 0) {
    for (let i = 0; i < threadIds.length; i += chunkSize) {
      const slice = threadIds.slice(i, i + chunkSize);
      const { data: batch, error: emErr } = await supabase
        .from("emails")
        .select("thread_id, sender, sender_name, sent_at, direction, is_starred")
        .in("thread_id", slice)
        .order("sent_at", { ascending: false });
      if (emErr) {
        toast.error(emErr.message);
        throw emErr;
      }
      latestEmailRows.push(...((batch ?? []) as EmailRow[]));
    }
    latestEmailRows.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  }

  const latestByThread: Record<string, { sender: string; sender_name: string | null }> = {};
  const starredThreadIds = new Set<string>();
  const sentThreadIds = new Set<string>();
  for (const e of latestEmailRows) {
    if (e.direction === "inbound" && !latestByThread[e.thread_id!]) {
      latestByThread[e.thread_id!] = { sender: e.sender, sender_name: e.sender_name };
    }
    if (e.is_starred) starredThreadIds.add(e.thread_id!);
    if (e.direction === "outbound") sentThreadIds.add(e.thread_id!);
  }

  return allThreads.map((t) => {
    const row = t as ThreadRow;
    const id = row.id;
    const acc = accountsById[row.account_id];
    return {
      ...row,
      account: acc ? { email_address: acc.email_address, color: acc.color } : null,
      latest_sender: latestByThread[id]?.sender ?? null,
      latest_sender_name: latestByThread[id]?.sender_name ?? null,
      has_starred: starredThreadIds.has(id),
      has_outbound: sentThreadIds.has(id),
    };
  });
}
