// Encrypt and store IMAP/SMTP credentials server-side. Plaintext password never persisted.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalizeMailboxPassword } from "../_shared/mail-credentials.ts";
import { testImapConnection } from "../_shared/imap-connect.ts";

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

    const emailTrim = typeof email_address === "string" ? email_address.trim().toLowerCase() : "";
    const imapPass = typeof imap_password === "string" ? normalizeMailboxPassword(imap_password) : "";
    const smtpPassRaw = typeof smtp_password === "string" && smtp_password.length > 0 ? smtp_password : imap_password;
    const smtpPass = typeof smtpPassRaw === "string" && smtpPassRaw.length > 0 ? normalizeMailboxPassword(smtpPassRaw) : imapPass;
    const imapUser = typeof imap_username === "string" && imap_username.trim()
      ? imap_username.trim().toLowerCase()
      : emailTrim;
    const smtpUser = typeof smtp_username === "string" && smtp_username.trim()
      ? smtp_username.trim().toLowerCase()
      : emailTrim;

    if (!emailTrim || !imap_host || !imapPass || !smtp_host || !imapUser || !smtpUser || !smtpPass) {
      return new Response(JSON.stringify({ error: "Missing required fields (email, IMAP/SMTP hosts, password)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("user_id", user.id)
      .ilike("email_address", emailTrim)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ error: "This email address is already connected. Remove the existing account first or update it in settings." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imapPort = imap_port ?? 993;
    const imapTls = imap_use_tls !== false;
    let resolvedImapHost = String(imap_host).trim();
    let resolvedSmtpHost = String(smtp_host).trim();
    let resolvedImapPort = imapPort;
    let resolvedImapTls = imapTls;

    try {
      const tested = await testImapConnection(resolvedImapHost, resolvedImapPort, resolvedImapTls, imapUser, imapPass);
      resolvedImapHost = tested.imap_host;
      resolvedImapPort = tested.imap_port;
      resolvedImapTls = tested.imap_use_tls;
      resolvedSmtpHost = tested.smtp_host;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: account, error } = await supabase.from("email_accounts").insert({
      user_id: user.id,
      email_address: emailTrim,
      display_name: display_name ?? null,
      color: color ?? "#3b82f6",
      provider_type: "imap",
      sync_status: "idle",
      imap_host: resolvedImapHost,
      imap_port: resolvedImapPort,
      imap_username: imapUser,
      imap_password_encrypted: encryptPassword(imapPass),
      imap_use_tls: resolvedImapTls,
      smtp_host: resolvedSmtpHost,
      smtp_port: smtp_port ?? 465,
      smtp_username: smtpUser,
      smtp_password_encrypted: encryptPassword(smtpPass),
    }).select().single();

    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({
      ok: true,
      account_id: account.id,
      resolved_imap_host: resolvedImapHost,
      resolved_smtp_host: resolvedSmtpHost,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("account-credentials error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
