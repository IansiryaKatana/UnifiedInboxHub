// Send an outbound email through the user's custom SMTP server (parity with gmail-send).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { isUuid, normalizeMessageId, resolveThreadingForSend, type ParentMailRow } from "../_shared/rfc-mail.ts";
import { resolveAttachmentsForMime, type AttachmentInput } from "../_shared/resolve-attachments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { normalizeMailboxPassword } from "../_shared/mail-credentials.ts";

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

    const reqBody = await req.json();
    const {
      account_id,
      thread_id,
      to,
      cc,
      bcc,
      subject,
      body_text,
      html_body,
      attachments: rawAttachments,
      in_reply_to,
    } = reqBody;
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

    let parentRow: ParentMailRow | null = null;
    const ir = typeof in_reply_to === "string" ? in_reply_to.trim() : "";
    if (ir && isUuid(ir)) {
      const { data: pr } = await supabase
        .from("emails")
        .select("rfc_message_id, references_header")
        .eq("id", ir)
        .eq("user_id", user.id)
        .maybeSingle();
      if (pr) parentRow = pr as ParentMailRow;
    }

    const threading = resolveThreadingForSend(ir || null, parentRow, String(account.email_address ?? "mail@localhost"));

    const mimeAttachments = await resolveAttachmentsForMime(supabase, Array.isArray(rawAttachments) ? rawAttachments as AttachmentInput[] : []);

    const password = normalizeMailboxPassword(decryptPassword(account.smtp_password_encrypted));
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
    const mid = normalizeMessageId(threading.outboundMessageId);
    if (mid) headers["Message-ID"] = mid;
    const irt = threading.inReplyTo ? normalizeMessageId(threading.inReplyTo) : null;
    if (irt) headers["In-Reply-To"] = irt;
    if (threading.references) headers["References"] = threading.references;

    await client.send({
      from: account.display_name ? `${account.display_name} <${account.email_address}>` : account.email_address,
      to,
      cc: Array.isArray(cc) ? cc : undefined,
      bcc: Array.isArray(bcc) ? bcc : undefined,
      subject: subject ?? "(no subject)",
      content: body_text,
      html: typeof html_body === "string" ? html_body : undefined,
      attachments: mimeAttachments.map((a) => ({
        filename: a.filename,
        content: Uint8Array.from(atob(a.data_base64), (c) => c.charCodeAt(0)),
        contentType: a.mime_type || "application/octet-stream",
        encoding: "binary",
      })),
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

    const storedAttachments = Array.isArray(rawAttachments)
      ? (rawAttachments as AttachmentInput[]).map((a) => ({
        filename: a.filename,
        mime_type: a.mime_type || "application/octet-stream",
        size: a.size ?? 0,
        inline: false,
        content_id: null,
        data_base64: a.storage_path ? null : a.data_base64 ?? null,
        storage_path: a.storage_path ?? null,
      }))
      : [];

    await supabase.from("emails").insert({
      user_id: user.id,
      account_id,
      thread_id: thread_id ?? null,
      direction: "outbound",
      rfc_message_id: threading.outboundMessageId,
      references_header: threading.references || null,
      sender: account.email_address,
      sender_name: account.display_name,
      recipient: to,
      cc: Array.isArray(cc) ? cc : [],
      bcc: Array.isArray(bcc) ? bcc : [],
      subject: subject ?? "(no subject)",
      snippet: body_text.slice(0, 140),
      body_text,
      body_html: typeof html_body === "string" ? html_body : null,
      attachments: storedAttachments,
      is_read: true,
      sent_at: sentAt,
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("smtp-send error:", msg);
    const reconnect = /credentials|auth|password|535|534/i.test(msg);
    return new Response(JSON.stringify({ error: msg, code: reconnect ? "CHECK_SMTP" : undefined }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
