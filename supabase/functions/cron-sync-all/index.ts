// Triggered every 5 minutes by pg_cron. Iterates all email_accounts and invokes the right
// sync function per provider. Authenticated by a shared SYNC_CRON_SECRET header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("SYNC_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, user_id, provider_type")
    .in("provider_type", ["gmail", "imap"]);

  const results: any[] = [];
  for (const acc of accounts ?? []) {
    // Mint a short-lived JWT for this user so the per-provider function authorizes correctly
    const fn = acc.provider_type === "gmail" ? "gmail-sync" : "imap-sync";
    try {
      // Inline call to the same project: use service-role key as Authorization is OK since
      // the per-provider function checks user via getUser; however service-role bypasses that.
      // To keep ownership, we call directly with service role and pass user_id-aware queries
      // by reusing the existing functions only via internal HTTP with a service-role auth header.
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "x-internal-cron": "1",
          "x-account-user-id": acc.user_id,
        },
        body: JSON.stringify({ account_id: acc.id }),
      });
      results.push({ id: acc.id, ok: res.ok, status: res.status });
    } catch (e) {
      results.push({ id: acc.id, ok: false, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
