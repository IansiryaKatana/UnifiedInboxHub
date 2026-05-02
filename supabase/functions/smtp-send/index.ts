// Send an outbound email through the user's custom SMTP server.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MailAttachment = {
  filename: string;
  mime_type: string;
  size?: number;
  data_base64?: string;
};

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
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { account_id, thread_id, to, cc, bcc, subject, body_text, html_body, attachments, in_reply_to } = await req.json();
    if (!account_id || !to || !body_text) {
      return new Response(JSON.stringify({ error: "account_id, to, body_text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: account } = await supabase.from("email_accounts").select("*").eq("id", account_id).eq("user_id", user.id).single();
    if (!account || account.provider_type !== "imap") {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!account.smtp_host || !account.smtp_username || !account.smtp_password_encrypted) {
      return new Response(JSON.stringify({ error: "SMTP credentials missing" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const password = decryptPassword(account.smtp_password_encrypted);
    const port = account.smtp_port ?? 465;
    const client = new SMTPClient({
      connection: {
        hostname: account.smtp_host,
        port,
        tls: port === 465,
        auth: { username: account.smtp_username, password },
      },
    });

    const headers: Record<string, string> = {};
    if (in_reply_to) {
      headers["In-Reply-To"] = in_reply_to;
      headers["References"] = in_reply_to;
    }

    await client.send({
      from: account.display_name ? `${account.display_name} <${account.email_address}>` : account.email_address,
      to,
      cc: Array.isArray(cc) ? cc : undefined,
      bcc: Array.isArray(bcc) ? bcc : undefined,
      subject: subject ?? "(no subject)",
      content: body_text,
      html: typeof html_body === "string" ? html_body : undefined,
      attachments: Array.isArray(attachments)
        ? attachments.map((a: MailAttachment) => ({
          filename: a.filename,
          content: a.data_base64 ? Uint8Array.from(atob(a.data_base64), (c) => c.charCodeAt(0)) : new Uint8Array(),
          contentType: a.mime_type || "application/octet-stream",
          encoding: "binary",
        }))
        : undefined,
      headers,
    });
    await client.close();

    const sentAt = new Date().toISOString();
    if (thread_id) {
      const { data: msgs } = await supabase.from("emails").select("id").eq("thread_id", thread_id);
      await supabase.from("email_threads").update({
        last_message_at: sentAt,
        snippet: body_text.slice(0, 140),
        message_count: (msgs?.length ?? 0) + 1,
      }).eq("id", thread_id);
    }

    await supabase.from("emails").insert({
      user_id: user.id,
      account_id,
      thread_id: thread_id ?? null,
      direction: "outbound",
      sender: account.email_address,
      sender_name: account.display_name,
      recipient: to,
      cc: Array.isArray(cc) ? cc : [],
      bcc: Array.isArray(bcc) ? bcc : [],
      subject: subject ?? "(no subject)",
      snippet: body_text.slice(0, 140),
      body_text,
      body_html: typeof html_body === "string" ? html_body : null,
      attachments: Array.isArray(attachments) ? attachments.map((a: MailAttachment) => ({
        filename: a.filename,
        mime_type: a.mime_type,
        size: a.size ?? 0,
        inline: false,
        content_id: null,
        data_base64: a.data_base64 ?? null,
      })) : [],
      is_read: true,
      sent_at: sentAt,
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("smtp-send error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
