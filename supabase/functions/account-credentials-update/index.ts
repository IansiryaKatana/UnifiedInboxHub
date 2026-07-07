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

function decryptPassword(encrypted: string): string {
  const key = Deno.env.get("IMAP_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  try {
    const bin = atob(encrypted);
    let out = "";
    for (let i = 0; i < bin.length; i++) {
      out += String.fromCharCode(bin.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  } catch {
    return "";
  }
}

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
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const { account_id } = body ?? {};
    if (!account_id) {
      return new Response(JSON.stringify({ error: "account_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: account, error: fetchErr } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", account_id)
      .eq("user_id", user.id)
      .single();
    if (fetchErr || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, unknown> = {};
    let passwordChanged = false;
    let newPassword = "";

    if (typeof body.email_address === "string" && body.email_address.trim()) updates.email_address = body.email_address.trim();
    if (typeof body.display_name === "string") updates.display_name = body.display_name.trim() || null;
    if (typeof body.color === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(body.color)) updates.color = body.color;

    if (account.provider_type === "imap") {
      if (typeof body.imap_host === "string" && body.imap_host.trim()) updates.imap_host = body.imap_host.trim();
      if (typeof body.imap_port === "number" && Number.isFinite(body.imap_port)) updates.imap_port = body.imap_port;
      if (typeof body.imap_username === "string" && body.imap_username.trim()) updates.imap_username = body.imap_username.trim();
      if (typeof body.imap_use_tls === "boolean") updates.imap_use_tls = body.imap_use_tls;

      if (typeof body.smtp_host === "string" && body.smtp_host.trim()) updates.smtp_host = body.smtp_host.trim();
      if (typeof body.smtp_port === "number" && Number.isFinite(body.smtp_port)) updates.smtp_port = body.smtp_port;
      if (typeof body.smtp_username === "string" && body.smtp_username.trim()) updates.smtp_username = body.smtp_username.trim();
      if (typeof body.imap_password === "string" && body.imap_password.length > 0) {
        const normalized = normalizeMailboxPassword(body.imap_password);
        updates.imap_password_encrypted = encryptPassword(normalized);
        newPassword = normalized;
        passwordChanged = true;
        if (typeof body.smtp_password !== "string" || body.smtp_password.length === 0) {
          updates.smtp_password_encrypted = encryptPassword(normalized);
        }
      }
      if (typeof body.smtp_password === "string" && body.smtp_password.length > 0) {
        updates.smtp_password_encrypted = encryptPassword(normalizeMailboxPassword(body.smtp_password));
      }
    }

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ ok: true, account_id: account.id, unchanged: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imapHost = String(updates.imap_host ?? account.imap_host ?? "").trim();
    const imapPort = typeof updates.imap_port === "number" ? updates.imap_port : (account.imap_port ?? 993);
    const imapTls = typeof updates.imap_use_tls === "boolean" ? updates.imap_use_tls : (account.imap_use_tls !== false);
    const imapUser = String(updates.imap_username ?? account.imap_username ?? account.email_address).trim().toLowerCase();
    const imapPass = passwordChanged
      ? newPassword
      : normalizeMailboxPassword(decryptPassword(account.imap_password_encrypted ?? ""));

    const hostChanged = imapHost !== String(account.imap_host ?? "").trim();
    const credsChanged = passwordChanged || hostChanged
      || (typeof updates.imap_port === "number" && updates.imap_port !== account.imap_port)
      || (typeof updates.imap_use_tls === "boolean" && updates.imap_use_tls !== account.imap_use_tls);

    if (account.provider_type === "imap" && credsChanged && imapHost && imapPass) {
      try {
        const tested = await testImapConnection(imapHost, imapPort, imapTls, imapUser, imapPass);
        updates.imap_host = tested.imap_host;
        updates.imap_port = tested.imap_port;
        updates.imap_use_tls = tested.imap_use_tls;
        updates.smtp_host = tested.smtp_host;
        updates.sync_status = "idle";
        updates.last_sync_error = null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ ok: false, error: msg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { error: upErr } = await supabase
      .from("email_accounts")
      .update(updates)
      .eq("id", account.id)
      .eq("user_id", user.id);

    if (upErr) throw new Error(upErr.message);

    return new Response(JSON.stringify({
      ok: true,
      account_id: account.id,
      resolved_imap_host: updates.imap_host ?? account.imap_host,
      resolved_smtp_host: updates.smtp_host ?? account.smtp_host,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("account-credentials-update error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
