// Deletes an email account and all synced mail in server-side batches (avoids browser/PostgREST timeouts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type BatchResult = {
  emails_deleted: number;
  threads_deleted: number;
  remaining_emails: number;
  remaining_threads: number;
  has_more?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const accountId = typeof body.account_id === "string" ? body.account_id : "";
    if (!accountId) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: account, error: accErr } = await userClient
      .from("email_accounts")
      .select("id")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (accErr || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: disconnectError } = await userClient
      .from("email_accounts")
      .update({ sync_status: "disconnected" })
      .eq("id", accountId);
    if (disconnectError) throw new Error(disconnectError.message);

    let totalEmailsDeleted = 0;
    let totalThreadsDeleted = 0;
    let batches = 0;
    const startedAt = Date.now();

    while (true) {
      batches += 1;
      const { data, error } = await adminClient.rpc("delete_email_account_data_batch", {
        p_account_id: accountId,
        p_user_id: user.id,
      });
      if (error) throw new Error(error.message);

      const batch = data as BatchResult;
      totalEmailsDeleted += batch.emails_deleted ?? 0;
      totalThreadsDeleted += batch.threads_deleted ?? 0;

      const hasMore = batch.has_more ??
        ((batch.remaining_emails ?? 0) > 0 || (batch.remaining_threads ?? 0) > 0);
      if (!hasMore) break;
      if ((batch.emails_deleted ?? 0) === 0 && (batch.threads_deleted ?? 0) === 0) {
        throw new Error("Unable to delete account data");
      }

      if (Date.now() - startedAt > 140_000) {
        throw new Error("Account removal timed out — please try again");
      }
    }

    const { error: deleteError } = await userClient.from("email_accounts").delete().eq("id", accountId);
    if (deleteError) throw new Error(deleteError.message);

    return new Response(JSON.stringify({
      ok: true,
      emails_deleted: totalEmailsDeleted,
      threads_deleted: totalThreadsDeleted,
      batches,
      duration_ms: Date.now() - startedAt,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
