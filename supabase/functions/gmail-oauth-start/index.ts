// Initiate Google OAuth: returns an authorization URL the browser redirects to.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
].join(" ");

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

    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID not configured");

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const returnTo = typeof body.return_to === "string" ? body.return_to : "";
    const rawPopup = body.popup;
    const popup =
      rawPopup === true ||
      rawPopup === "true" ||
      String(rawPopup ?? "").toLowerCase() === "true";

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;
    // Encode user id + return URL in state so callback can attach the account to the right user
    const state = btoa(JSON.stringify({ user_id: user.id, return_to: returnTo, popup, nonce: crypto.randomUUID() }));

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);

    return new Response(JSON.stringify({ ok: true, url: url.toString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gmail-oauth-start error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
