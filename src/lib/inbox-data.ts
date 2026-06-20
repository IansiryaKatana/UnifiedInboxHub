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
  updated_at?: string | null;
  created_at?: string | null;
}

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
export async function fetchEnrichedThreads(): Promise<ThreadRow[]> {
  const { data, error } = await supabase.rpc("get_inbox_threads_enriched", {
    p_limit: 1000,
    p_offset: 0,
  });
  if (error) {
    toast.error(error.message);
    throw error;
  }
  return (data ?? []).map((row) => row.result as unknown as ThreadRow);
}
