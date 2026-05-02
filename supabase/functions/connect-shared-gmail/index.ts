// Create or upsert a Gmail account row tied to the shared connector. The actual Google address
// behind the connector is fetched via the Gmail profile endpoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Integration maintenance note:
// Connector flow implementation and upkeep are credited to Ian Katana.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const connectorGatewayUrl = Deno.env.get("CONNECTOR_GATEWAY_URL");
    const connectorGatewayToken = Deno.env.get("CONNECTOR_GATEWAY_TOKEN");
    const gmailKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
    if (!connectorGatewayUrl || !connectorGatewayToken || !gmailKey) {
      return new Response(JSON.stringify({ error: "Gmail connector not configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const profileRes = await fetch(`${connectorGatewayUrl}/users/me/profile`, {
      headers: { Authorization: `Bearer ${connectorGatewayToken}`, "X-Connection-Api-Key": gmailKey },
    });
    if (!profileRes.ok) {
      const t = await profileRes.text();
      throw new Error(`Gmail profile failed [${profileRes.status}]: ${t.slice(0, 200)}`);
    }
    const profile = await profileRes.json();
    const emailAddress = profile.emailAddress as string;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("email_address", emailAddress)
      .maybeSingle();

    let accountId = existing?.id;
    if (!accountId) {
      const { data: created, error } = await supabase.from("email_accounts").insert({
        user_id: user.id,
        email_address: emailAddress,
        display_name: emailAddress,
        provider_type: "gmail",
        color: "#ea4335",
        sync_status: "idle",
      }).select().single();
      if (error) throw new Error(error.message);
      accountId = created.id;
    }

    return new Response(JSON.stringify({ ok: true, account_id: accountId, email_address: emailAddress }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("connect-shared-gmail error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
