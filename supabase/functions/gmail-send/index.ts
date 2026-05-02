// Send a Gmail message via per-account OAuth and persist a copy in emails.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isUuid, normalizeMessageId, resolveThreadingForSend } from "../_shared/rfc-mail.ts";
import type { ParentMailRow } from "../_shared/rfc-mail.ts";
import { resolveAttachmentsForMime, type AttachmentInput } from "../_shared/resolve-attachments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

type AccountWithOauth = {
  id: string;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_token_expires_at: string | null;
};

type SupabaseUpdater = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<unknown>;
    };
  };
};

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0, 200)}`);
  return { access_token: data.access_token as string, expires_in: (data.expires_in as number) ?? 3600 };
}

async function getValidAccessToken(supabase: SupabaseUpdater, account: AccountWithOauth): Promise<string> {
  const now = Date.now();
  const expiresAt = account.oauth_token_expires_at ? new Date(account.oauth_token_expires_at).getTime() : 0;
  if (account.oauth_access_token && expiresAt > now + 30_000) return account.oauth_access_token;
  if (!account.oauth_refresh_token) throw new Error("Account missing OAuth refresh token. Please reconnect Gmail.");
  const { access_token, expires_in } = await refreshAccessToken(account.oauth_refresh_token);
  await supabase.from("email_accounts").update({
    oauth_access_token: access_token,
    oauth_token_expires_at: new Date(Date.now() + (expires_in - 60) * 1000).toISOString(),
  }).eq("id", account.id);
  return access_token;
}

type MailAttachment = {
  filename: string;
  mime_type: string;
  size?: number;
  data_base64: string;
};

function encodeBase64UrlUtf8(input: string) {
  const utf8 = new TextEncoder().encode(input);
  let bin = "";
  utf8.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRaw({
  from,
  to,
  cc,
  bcc,
  subject,
  body,
  htmlBody,
  messageId,
  inReplyTo,
  references,
  attachments,
}: {
  from: string;
  to: string;
  cc?: string[] | null;
  bcc?: string[] | null;
  subject: string;
  body: string;
  htmlBody?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: MailAttachment[];
}) {
  const mixedBoundary = `mixed_${crypto.randomUUID()}`;
  const altBoundary = `alt_${crypto.randomUUID()}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc && cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc && bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];
  if (messageId) lines.push(`Message-ID: ${messageId}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);

  const hasAttachments = (attachments?.length ?? 0) > 0;
  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, "");
    lines.push(`--${mixedBoundary}`);
  }

  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`, "");
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 7bit", "", body, "");
  if (htmlBody && htmlBody.trim()) {
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: 7bit", "", htmlBody, "");
  }
  lines.push(`--${altBoundary}--`);

  if (hasAttachments) {
    for (const file of attachments ?? []) {
      lines.push(`--${mixedBoundary}`);
      lines.push(
        `Content-Type: ${file.mime_type || "application/octet-stream"}; name="${file.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${file.filename}"`,
        "",
      );
      lines.push(file.data_base64.replace(/(.{76})/g, "$1\r\n"));
    }
    lines.push(`--${mixedBoundary}--`);
  }

  return encodeBase64UrlUtf8(lines.join("\r\n"));
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

    const body = await req.json();
    const { account_id, thread_id, to, cc, bcc, subject, body_text, html_body, in_reply_to, attachments: rawAttachments } = body ?? {};
    if (!account_id || !to || !body_text) {
      return new Response(JSON.stringify({ error: "account_id, to, body_text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: account } = await supabase.from("email_accounts").select("*").eq("id", account_id).eq("user_id", user.id).single();
    if (!account) return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (account.provider_type !== "gmail") return new Response(JSON.stringify({ error: "Not a Gmail account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    const accessToken = await getValidAccessToken(supabase, account);

    const raw = buildRaw({
      from: account.display_name ? `${account.display_name} <${account.email_address}>` : account.email_address,
      to,
      cc: Array.isArray(cc) ? cc : [],
      bcc: Array.isArray(bcc) ? bcc : [],
      subject: subject ?? "(no subject)",
      body: body_text,
      htmlBody: typeof html_body === "string" ? html_body : null,
      messageId: normalizeMessageId(threading.outboundMessageId),
      inReplyTo: threading.inReplyTo ? normalizeMessageId(threading.inReplyTo) : null,
      references: threading.references || null,
      attachments: mimeAttachments,
    });

    const sendRes = await fetch(`${GMAIL_API}/users/me/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(`Gmail send failed [${sendRes.status}]: ${JSON.stringify(sendData).slice(0, 300)}`);

    const sentAt = new Date().toISOString();
    if (thread_id) {
      const { data: msgs } = await supabase.from("emails").select("id").eq("thread_id", thread_id);
      await supabase.from("email_threads")
        .update({ last_message_at: sentAt, snippet: body_text.slice(0, 140), message_count: (msgs?.length ?? 0) + 1 })
        .eq("id", thread_id);
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
      user_id: user.id, account_id, thread_id: thread_id ?? null,
      provider_message_id: sendData.id ?? null, direction: "outbound",
      rfc_message_id: threading.outboundMessageId,
      references_header: threading.references || null,
      sender: account.email_address, sender_name: account.display_name, recipient: to,
      cc: Array.isArray(cc) ? cc : [],
      bcc: Array.isArray(bcc) ? bcc : [],
      subject: subject ?? "(no subject)", snippet: body_text.slice(0, 140),
      body_text,
      body_html: typeof html_body === "string" ? html_body : null,
      attachments: storedAttachments,
      is_read: true,
      sent_at: sentAt,
    });

    return new Response(JSON.stringify({ ok: true, message_id: sendData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gmail-send error:", msg);
    const reconnect = /OAuth|token|refresh|401|403/i.test(msg);
    return new Response(JSON.stringify({ error: msg, code: reconnect ? "RECONNECT_GMAIL" : undefined }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
