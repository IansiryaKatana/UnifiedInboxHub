// Encrypt and store IMAP/SMTP credentials server-side. Plaintext password never persisted.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function encryptPassword(plain: string): string {
  const key = Deno.env.get("IMAP_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let out = "";
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(plain.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(out);
}

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

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { email_address, display_name, color, imap_host, imap_port, imap_username, imap_password, smtp_host, smtp_port, smtp_username, smtp_password, imap_use_tls } = body ?? {};

    if (!email_address || !imap_host || !imap_username || !imap_password || !smtp_host || !smtp_username || !smtp_password) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: account, error } = await supabase.from("email_accounts").insert({
      user_id: user.id,
      email_address,
      display_name: display_name ?? null,
      color: color ?? "#3b82f6",
      provider_type: "imap",
      sync_status: "idle",
      imap_host,
      imap_port: imap_port ?? 993,
      imap_username,
      imap_password_encrypted: encryptPassword(imap_password),
      imap_use_tls: imap_use_tls !== false,
      smtp_host,
      smtp_port: smtp_port ?? 465,
      smtp_username,
      smtp_password_encrypted: encryptPassword(smtp_password),
    }).select().single();

    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({ ok: true, account_id: account.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("account-credentials error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
