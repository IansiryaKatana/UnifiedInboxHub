// Sync Gmail messages using per-account OAuth tokens (each user's own Gmail).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { notifyNewInboundEmail } from "../_shared/push-notify.ts";
import { normalizeMessageId } from "../_shared/rfc-mail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
/** Client passes this as start_page_token when server hit fetch budget on inbox page 1 (token=null). */
const INBOX_PAGE_RETRY = "__INBOX_PAGE_RETRY__";
const MAX_EMBED_ATTACHMENT_BYTES = 2_500_000;
interface SyncedAttachment {
  filename: string;
  mime_type: string;
  size: number;
  inline: boolean;
  content_id: string | null;
  data_base64: string | null;
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0, 200)}`);
  return { access_token: data.access_token as string, expires_in: (data.expires_in as number) ?? 3600 };
}

async function getValidAccessToken(supabase: any, account: any): Promise<string> {
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

function getHeader(headers: any[], name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function parseAddress(raw: string | null): { email: string; name: string | null } {
  if (!raw) return { email: "", name: null };
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim(), name: m[1].trim() || null };
  return { email: raw.trim(), name: null };
}

function decodeBase64Url(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(norm), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function decodeBase64UrlBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

async function extractBodyAndAttachments(
  payload: any,
  fetchAttachment: (attachmentId: string) => Promise<Uint8Array | null>,
): Promise<{ text: string; html: string; attachments: SyncedAttachment[] }> {
  let text = "";
  let html = "";
  const attachments: SyncedAttachment[] = [];
  const walk = (p: any) => {
    if (!p) return;
    const mime = p.mimeType ?? "";
    if (p.body?.data) {
      const decoded = decodeBase64Url(p.body.data);
      if (mime === "text/plain" && !text) text = decoded;
      else if (mime === "text/html" && !html) html = decoded;
    }
    if (p.parts) for (const part of p.parts) walk(part);
  };
  const collectParts = async (p: any) => {
    if (!p) return;
    const mime = String(p.mimeType ?? "application/octet-stream");
    const filename = String(p.filename ?? "");
    const body = p.body ?? {};
    const attachmentId = body.attachmentId as string | undefined;
    const size = Number(body.size ?? 0);
    const isAttachmentLike = Boolean(filename) || Boolean(attachmentId);
    if (isAttachmentLike) {
      const headers: any[] = p.headers ?? [];
      const contentIdRaw = headers.find((h) => String(h.name ?? "").toLowerCase() === "content-id")?.value ?? null;
      const contentId = contentIdRaw ? String(contentIdRaw).replace(/[<>]/g, "").trim() : null;
      const disposition = String(
        headers.find((h) => String(h.name ?? "").toLowerCase() === "content-disposition")?.value ?? "",
      ).toLowerCase();
      const inline = disposition.includes("inline") || !!contentId;

      let bytes: Uint8Array | null = null;
      if (body.data) bytes = decodeBase64UrlBytes(body.data);
      else if (attachmentId) bytes = await fetchAttachment(attachmentId);

      const dataBase64 = bytes && bytes.byteLength <= MAX_EMBED_ATTACHMENT_BYTES
        ? bytesToBase64(bytes)
        : null;
      attachments.push({
        filename: filename || (inline ? "inline" : "attachment"),
        mime_type: mime,
        size: size || bytes?.byteLength || 0,
        inline,
        content_id: contentId,
        data_base64: dataBase64,
      });
    }
    if (p.parts) {
      for (const part of p.parts) await collectParts(part);
    }
  };

  walk(payload);
  await collectParts(payload);

  let safeHtml = sanitizeHtml(html);
  for (const att of attachments) {
    if (!att.inline || !att.content_id || !att.data_base64) continue;
    const dataUrl = `data:${att.mime_type};base64,${att.data_base64}`;
    const cidRegex = new RegExp(`cid:${att.content_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
    safeHtml = safeHtml.replace(cidRegex, dataUrl);
  }
  return { text, html: safeHtml, attachments };
}

async function importGmailMessage(
  supabase: any,
  userId: string,
  accountId: string,
  account: Record<string, unknown>,
  ref: { id: string; threadId: string },
  gHeaders: Record<string, string>,
  fetchBudget?: { remaining: number },
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("emails").select("id").eq("account_id", accountId).eq("provider_message_id", ref.id).maybeSingle();
  if (existing) return false;

  if (fetchBudget && fetchBudget.remaining <= 0) return false;
  if (fetchBudget) fetchBudget.remaining--;

  const msgRes = await fetch(`${GMAIL_API}/users/me/messages/${ref.id}?format=full`, { headers: gHeaders });
  if (!msgRes.ok) return false;
  const msg = await msgRes.json();

  const headers = msg.payload?.headers ?? [];
  const subject = getHeader(headers, "Subject");
  const fromRaw = getHeader(headers, "From");
  const toRaw = getHeader(headers, "To") ?? String(account.email_address ?? "");
  const dateRaw = getHeader(headers, "Date");
  const rfc_message_id = normalizeMessageId(getHeader(headers, "Message-ID")) ??
    normalizeMessageId(`gmail-internal-${ref.id}@invalid.local`);
  const references_header = getHeader(headers, "References")?.trim() ?? null;

  const from = parseAddress(fromRaw);
  const to = parseAddress(toRaw);
  const sentAt = dateRaw ? new Date(dateRaw).toISOString() : new Date(parseInt(msg.internalDate ?? `${Date.now()}`)).toISOString();
  const fetchAttachment = async (attachmentId: string) => {
    const res = await fetch(`${GMAIL_API}/users/me/messages/${ref.id}/attachments/${attachmentId}`, { headers: gHeaders });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data) return null;
    try {
      return decodeBase64UrlBytes(data.data);
    } catch {
      return null;
    }
  };
  const { text, html, attachments } = await extractBodyAndAttachments(msg.payload, fetchAttachment);
  const snippet = (msg.snippet ?? text.slice(0, 140)).slice(0, 240);
  const isUnread = (msg.labelIds ?? []).includes("UNREAD");

  let threadId: string | null = null;
  const labelIds = (msg.labelIds ?? []) as string[];
  const mergeLabels = (prev: string[] | null | undefined) => {
    const set = new Set<string>([...(prev ?? []), ...labelIds]);
    return [...set];
  };

  const { data: existingThread } = await supabase
    .from("email_threads").select("id, message_count, unread_count, gmail_label_ids")
    .eq("account_id", accountId).eq("provider_thread_id", ref.threadId).maybeSingle();

  if (existingThread) {
    threadId = existingThread.id;
    await supabase.from("email_threads").update({
      last_message_at: sentAt, snippet,
      message_count: (existingThread.message_count ?? 0) + 1,
      unread_count: (existingThread.unread_count ?? 0) + (isUnread ? 1 : 0),
      gmail_label_ids: mergeLabels(existingThread.gmail_label_ids as string[] | undefined),
    }).eq("id", threadId);
  } else {
    const { data: newThread } = await supabase.from("email_threads").insert({
      user_id: userId, account_id: accountId, provider_thread_id: ref.threadId,
      subject, snippet,
      participants: [from.email, to.email].filter(Boolean),
      last_message_at: sentAt, message_count: 1, unread_count: isUnread ? 1 : 0,
      gmail_label_ids: labelIds,
    }).select().single();
    threadId = newThread?.id ?? null;
  }

  if (!threadId) return false;

  const { data: inserted, error: insErr } = await supabase.from("emails").insert({
    user_id: userId, account_id: accountId, thread_id: threadId,
    provider_message_id: ref.id, direction: "inbound",
    rfc_message_id,
    references_header,
    sender: from.email, sender_name: from.name, recipient: to.email,
    subject, snippet, body_text: text, body_html: html,
    attachments,
    is_read: !isUnread, sent_at: sentAt,
  }).select("id").single();
  if (insErr || !inserted?.id) return false;
  const fromLabel = from.name ? `${from.name} (${from.email})` : from.email;
  const ageMs = Date.now() - new Date(sentAt).getTime();
  const isRecentInbound = ageMs >= 0 && ageMs < 48 * 60 * 60 * 1000;
  if (isRecentInbound) {
    try {
      await notifyNewInboundEmail(supabase, userId, {
        emailId: inserted.id,
        threadId,
        subject,
        snippet,
        from: fromLabel,
      });
    } catch (e) {
      console.error("notifyNewInboundEmail:", e);
    }
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let accountIdForError: string | undefined;
  let supabaseForCleanup: ReturnType<typeof createClient> | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    supabaseForCleanup = supabase;

    let userId: string | null = null;
    if (req.headers.get("x-internal-cron") === "1") {
      userId = req.headers.get("x-account-user-id");
    } else {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    }
    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body.account_id;
    accountIdForError = accountId;
    const maxResults: number | null = typeof body.max_results === "number"
      ? Math.max(1, Math.min(body.max_results, 5000))
      : null;
    const rawStart = typeof body.start_page_token === "string" ? body.start_page_token.trim() : "";
    const startPageToken: string | null = rawStart === INBOX_PAGE_RETRY
      ? null
      : rawStart || null;
    // Default one Gmail list page per invocation so a single edge request stays under relay limits (HTTP 546).
    const maxPages: number =
      typeof body.max_pages === "number"
        ? Math.max(1, Math.min(body.max_pages, 20))
        : 1;
    const pageSize: number = Math.max(1, Math.min(Number(body.page_size) || 20, 25));
    if (!accountId) return new Response(JSON.stringify({ error: "account_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: account, error: accErr } = await supabase
      .from("email_accounts").select("*").eq("id", accountId).eq("user_id", userId).single();
    if (accErr || !account) return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (account.provider_type !== "gmail") return new Response(JSON.stringify({ error: "Not a Gmail account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const STALE_SYNC_MS = 3 * 60 * 1000;
    if (account.sync_status === "syncing" && account.updated_at) {
      const age = Date.now() - new Date(account.updated_at).getTime();
      if (age < STALE_SYNC_MS) {
        return new Response(JSON.stringify({ ok: true, imported: 0, skipped: true, reason: "sync_in_progress" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    await supabase.from("email_accounts").update({ sync_status: "syncing", last_sync_error: null }).eq("id", accountId);

    const accessToken = await getValidAccessToken(supabase, account);
    const gHeaders = { Authorization: `Bearer ${accessToken}` };

    let imported = 0;
    let scanned = 0;

    // Hard cap Gmail `messages.get` calls per invocation (attachments + body); avoids HTTP 546 on heavy mail.
    const maxFullFetches = Math.max(3, Math.min(Number(body.max_full_fetches) || 10, 25));
    const fetchBudget = { remaining: maxFullFetches };

    // Optional: tiny recent catch-up (off by default — was causing timeouts combined with inbox pass).
    const recentCatchup =
      body.recent_catchup === true && !startPageToken && maxPages === 1;
    if (recentCatchup) {
      const recentUrl = new URL(`${GMAIL_API}/users/me/messages`);
      recentUrl.searchParams.set("maxResults", "12");
      recentUrl.searchParams.set("q", "newer_than:2d");
      const recentRes = await fetch(recentUrl.toString(), { headers: gHeaders });
      if (recentRes.ok) {
        const recentData = await recentRes.json();
        const recentBatch: { id: string; threadId: string }[] = recentData.messages ?? [];
        for (const ref of recentBatch) {
          if (maxResults && scanned >= maxResults) break;
          scanned++;
          const did = await importGmailMessage(supabase, userId, accountId, account, ref, gHeaders, fetchBudget);
          if (did) imported++;
          if (fetchBudget.remaining <= 0) break;
        }
      }
    }

    // INBOX — list and import page-by-page (never buffer entire mailbox first).
    let nextPageToken: string | null = startPageToken;
    let pages = 0;
    while (pages < maxPages) {
      const listPageToken = nextPageToken;
      const listUrl = new URL(`${GMAIL_API}/users/me/messages`);
      listUrl.searchParams.set("maxResults", String(pageSize));
      listUrl.searchParams.set("labelIds", "INBOX");
      if (listPageToken) listUrl.searchParams.set("pageToken", listPageToken);
      const listRes = await fetch(listUrl.toString(), { headers: gHeaders });
      if (!listRes.ok) {
        const t = await listRes.text();
        throw new Error(`Gmail list failed [${listRes.status}]: ${t.slice(0, 200)}`);
      }
      const listData = await listRes.json();
      const batch: { id: string; threadId: string }[] = listData.messages ?? [];
      const nextListPageToken = listData.nextPageToken ?? null;
      pages++;

      let budgetStoppedInner = false;
      for (const ref of batch) {
        if (fetchBudget.remaining <= 0) {
          budgetStoppedInner = true;
          break;
        }
        if (maxResults && scanned >= maxResults) break;
        scanned++;
        const did = await importGmailMessage(supabase, userId, accountId, account, ref, gHeaders, fetchBudget);
        if (did) imported++;
      }

      if (budgetStoppedInner || fetchBudget.remaining <= 0) {
        nextPageToken = listPageToken === null ? INBOX_PAGE_RETRY : listPageToken;
        break;
      }
      if (maxResults && scanned >= maxResults) {
        nextPageToken = nextListPageToken;
        break;
      }

      nextPageToken = nextListPageToken;
      if (!nextPageToken) break;
    }

    await supabase.from("email_accounts")
      .update({ sync_status: "idle", last_synced_at: new Date().toISOString() }).eq("id", accountId);

    const sync_continue = Boolean(nextPageToken);

    return new Response(JSON.stringify({
      ok: true,
      imported,
      scanned,
      pages,
      next_page_token: nextPageToken,
      sync_continue,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("gmail-sync error:", msg);
    try {
      if (accountIdForError) {
        const supabaseErr = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await supabaseErr.from("email_accounts").update({
          sync_status: "error",
          last_sync_error: msg.slice(0, 500),
        }).eq("id", accountIdForError);
      }
    } catch {
      /* ignore */
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    if (accountIdForError && supabaseForCleanup) {
      try {
        await supabaseForCleanup
          .from("email_accounts")
          .update({ sync_status: "idle" })
          .eq("id", accountIdForError)
          .eq("sync_status", "syncing");
      } catch {
        /* ignore */
      }
    }
  }
});
