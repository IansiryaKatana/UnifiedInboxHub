// Fetch new messages from a custom IMAP mailbox into the unified inbox.
// Uses npm:imapflow which works in Deno via npm: specifier.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { notifyNewInboundEmail } from "../_shared/push-notify.ts";
import { normalizeMessageId } from "../_shared/rfc-mail.ts";
import { ImapFlow } from "npm:imapflow@1.0.165";
import { simpleParser } from "npm:mailparser@3.7.1";

/** Broad headers so browser preflight + POST from localhost/dev always match (502 from gateway still has no CORS). */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept, accept-profile, content-profile, prefer, range, x-upsert, x-requested-with",
  "Access-Control-Max-Age": "86400",
};
const MAX_EMBED_ATTACHMENT_BYTES = 2_500_000;
interface SyncedAttachment {
  filename: string;
  mime_type: string;
  size: number;
  inline: boolean;
  content_id: string | null;
  data_base64: string | null;
}
interface ImapAttempt {
  port: number;
  secure: boolean;
  label: string;
}

function decryptPassword(encrypted: string): string {
  // Stored using base64 of XOR with project secret. Safe enough for v1; tighten with pgsodium later.
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

function isImapSeen(flags: Set<string> | undefined): boolean {
  if (!flags?.size) return false;
  for (const f of flags) {
    const fl = String(f);
    if (fl === "\\Seen" || fl === "Seen" || fl.toLowerCase() === "\\seen") return true;
  }
  return false;
}

/** mailparser can yield invalid dates; `toISOString()` would throw and fail the whole sync */
function toIsoSentAt(parsedDate: Date | undefined): string {
  const d = parsedDate instanceof Date ? parsedDate : new Date();
  const t = d.getTime();
  if (Number.isNaN(t)) return new Date().toISOString();
  return d.toISOString();
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  return code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint");
}

/** Resolve thread via In-Reply-To / References → existing Message-IDs in DB (RFC-first threading). */
async function findThreadIdByParentMessageIds(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  inReplyTo: string | null | undefined,
  referencesHeader: string | null | undefined,
): Promise<string | null> {
  const lookup = async (raw: string | null | undefined) => {
    const nid = normalizeMessageId(raw ?? null);
    if (!nid) return null;
    const { data } = await supabase
      .from("emails")
      .select("thread_id")
      .eq("account_id", accountId)
      .eq("rfc_message_id", nid)
      .maybeSingle();
    return data?.thread_id ?? null;
  };

  const fromReply = await lookup(inReplyTo ?? null);
  if (fromReply) return fromReply;

  const refs = (referencesHeader ?? "").trim().split(/\s+/).filter(Boolean);
  for (let i = refs.length - 1; i >= 0; i--) {
    const tid = await lookup(refs[i]);
    if (tid) return tid;
  }
  return null;
}

async function handleImapSync(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  let accountIdForError: string | undefined;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    /** Service role only — do not pass user JWT here; mixing JWT + service key can make PostgREST apply RLS oddly. */
    const supabaseAdmin = createClient(url, serviceKey);
    let userId: string | null = null;
    if (req.headers.get("x-internal-cron") === "1") {
      userId = req.headers.get("x-account-user-id");
    } else {
      const userClient = createClient(url, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    }
    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const user = { id: userId };

    const body = await req.json().catch(() => ({}));
    const account_id: string | undefined = body.account_id;
    const max_messages = body.max_messages;
    accountIdForError = account_id;
    if (!account_id) return new Response(JSON.stringify({ error: "account_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: account } = await supabaseAdmin.from("email_accounts").select("*").eq("id", account_id).eq("user_id", user.id).single();
    if (!account || account.provider_type !== "imap") {
      return new Response(JSON.stringify({ error: "IMAP account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!account.imap_host || !account.imap_username || !account.imap_password_encrypted) {
      return new Response(JSON.stringify({ error: "IMAP credentials missing" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabaseAdmin.from("email_accounts").update({ sync_status: "syncing", last_sync_error: null }).eq("id", account_id);

    const password = decryptPassword(account.imap_password_encrypted).trim();
    if (!password) {
      return new Response(JSON.stringify({
        error: "IMAP password decrypt failed or is empty. Set IMAP_SECRET_KEY to match the key used when the account was added, or re-save the password in account settings.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const host = String(account.imap_host).trim();
    const username = String(account.imap_username).trim();
    const configuredPort = account.imap_port ?? 993;
    const configuredSecure = account.imap_use_tls !== false;
    const priorUid = account.imap_last_uid ?? 0;
    /** Avoid Edge timeouts on first sync; callers can pass max_messages to raise the cap */
    let effectiveMax: number;
    if (typeof max_messages === "number") {
      effectiveMax = Math.max(1, Math.min(max_messages, 5000));
    } else if (priorUid === 0) {
      effectiveMax = 250;
    } else {
      effectiveMax = 5000;
    }

    const attempts: ImapAttempt[] = [
      { port: configuredPort, secure: configuredSecure, label: "configured" },
    ];
    if (configuredPort === 993 && configuredSecure) {
      attempts.push({ port: 143, secure: false, label: "fallback-starttls-143" });
    } else if (configuredPort === 143 && !configuredSecure) {
      attempts.push({ port: 993, secure: true, label: "fallback-ssl-993" });
      attempts.push({ port: 143, secure: false, label: "fallback-starttls-143-alt" });
    }

    let client: ImapFlow | null = null;

    let imported = 0;
    let scanned = 0;
    let lastUid = account.imap_last_uid ?? 0;
    let connected = false;

    try {
      try {
        let lastError = "";
        for (const attempt of attempts) {
          try {
            client = new ImapFlow({
              host,
              port: attempt.port,
              secure: attempt.secure,
              auth: { user: username, pass: password },
              logger: false,
            });
            await client.connect();
            connected = true;
            break;
          } catch (err) {
            try { await client?.logout(); } catch { /* ignore */ }
            client = null;
            lastError = err instanceof Error ? err.message : String(err);
          }
        }
        if (!connected || !client) {
          throw new Error(lastError || "Unable to connect");
        }
      } catch (connErr) {
        const cm = connErr instanceof Error ? connErr.message : String(connErr);
        throw new Error(`IMAP connect failed (${account.imap_host}:${configuredPort}): ${cm}. Try Titan defaults: IMAP imap.titan.email:993 SSL (or 143 STARTTLS), SMTP smtp.titan.email:465 SSL (or 587 STARTTLS), username as full email, and app password if enabled.`);
      }
      const lock = await client.getMailboxLock("INBOX");
      try {
        const range = lastUid > 0 ? `${lastUid + 1}:*` : `1:*`;
        const uids: number[] = [];
        const uidFlags = new Map<number, Set<string>>();
        // UID + flags only (no envelope) — avoids downloading headers for every message on large mailboxes
        for await (const msg of client.fetch(range, { uid: true, flags: true }, { uid: true })) {
          uids.push(msg.uid);
          uidFlags.set(msg.uid, msg.flags ? new Set(msg.flags) : new Set());
        }
        const newUids = uids.filter((u) => u > lastUid).sort((a, b) => a - b);
        const toProcess = newUids.slice(0, effectiveMax);

        scanned = toProcess.length;
        for (const uid of toProcess) {
          try {
          const flagSet = uidFlags.get(uid);
          const seenOnServer = isImapSeen(flagSet);
          const { content } = await client.download(uid.toString(), undefined, { uid: true });
          const chunks: Uint8Array[] = [];
          for await (const chunk of content) chunks.push(chunk);
          const buffer = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let off = 0;
          for (const c of chunks) { buffer.set(c, off); off += c.length; }
          if (buffer.byteLength === 0) {
            console.warn(`imap-sync uid ${uid}: empty body, skipping`);
            if (uid > lastUid) lastUid = uid;
            continue;
          }
          const parsed = await simpleParser(buffer);

          const fromAddr = parsed.from?.value?.[0];
          const toAddr = parsed.to && "value" in parsed.to ? parsed.to.value?.[0] : null;
          const sender = fromAddr?.address ?? "unknown@unknown";
          const senderName = fromAddr?.name ?? null;
          const recipient = toAddr?.address ?? account.email_address;
          const subject = parsed.subject ?? null;
          const sentAt = toIsoSentAt(parsed.date);
          const text = parsed.text ?? "";
          const parsedHtml = typeof parsed.html === "string" ? parsed.html : null;
          const attachments: SyncedAttachment[] = (parsed.attachments ?? []).map((att) => {
            const content = att.content instanceof Uint8Array ? att.content : new Uint8Array();
            const dataBase64 = content.byteLength > 0 && content.byteLength <= MAX_EMBED_ATTACHMENT_BYTES
              ? bytesToBase64(content)
              : null;
            return {
              filename: att.filename ?? "attachment",
              mime_type: att.contentType ?? "application/octet-stream",
              size: att.size ?? content.byteLength ?? 0,
              inline: (att.contentDisposition ?? "").toLowerCase() === "inline" || !!att.cid,
              content_id: att.cid ?? null,
              data_base64: dataBase64,
            };
          });
          let html = parsedHtml ? sanitizeHtml(parsedHtml) : null;
          if (html) {
            for (const att of attachments) {
              if (!att.inline || !att.content_id || !att.data_base64) continue;
              const cidRegex = new RegExp(`cid:${att.content_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
              html = html.replace(cidRegex, `data:${att.mime_type};base64,${att.data_base64}`);
            }
          }
          const snippet = text.slice(0, 240);
          const messageId = parsed.messageId ?? `imap-${account_id}-${uid}`;
          const inReply = parsed.inReplyTo ?? null;
          const refsJoined = Array.isArray(parsed.references)
            ? parsed.references.map(String).join(" ").trim()
            : (typeof parsed.references === "string" ? parsed.references.trim() : "") || null;
          const rfc_message_id = normalizeMessageId(parsed.messageId ?? null) ??
            normalizeMessageId(`${messageId}@imap.local`);

          const { data: dupRow } = await supabaseAdmin
            .from("emails")
            .select("id")
            .eq("account_id", account_id)
            .eq("provider_message_id", messageId)
            .maybeSingle();
          if (dupRow?.id) {
            if (uid > lastUid) lastUid = uid;
            continue;
          }

          let threadId: string | null = await findThreadIdByParentMessageIds(
            supabaseAdmin,
            account_id,
            parsed.inReplyTo ? String(parsed.inReplyTo) : null,
            refsJoined,
          );

          const normSubj = (subject ?? "").replace(/^(re|fwd):\s*/i, "").trim();
          if (threadId) {
            const { data: existingTh } = await supabaseAdmin
              .from("email_threads")
              .select("id, message_count, unread_count")
              .eq("id", threadId)
              .maybeSingle();
            if (existingTh) {
              await supabaseAdmin.from("email_threads").update({
                last_message_at: sentAt,
                snippet,
                message_count: (existingTh.message_count ?? 0) + 1,
                unread_count: (existingTh.unread_count ?? 0) + (seenOnServer ? 0 : 1),
              }).eq("id", threadId);
            }
          } else if (normSubj.length >= 2) {
            const { data: existing } = await supabaseAdmin
              .from("email_threads")
              .select("id, message_count, unread_count")
              .eq("account_id", account_id)
              .ilike("subject", `%${normSubj}%`)
              .order("last_message_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (existing) {
              threadId = existing.id;
              await supabaseAdmin.from("email_threads").update({
                last_message_at: sentAt,
                snippet,
                message_count: (existing.message_count ?? 0) + 1,
                unread_count: (existing.unread_count ?? 0) + (seenOnServer ? 0 : 1),
              }).eq("id", threadId);
            }
          }

          if (!threadId) {
            const providerThreadKey = inReply ? String(inReply) : messageId;
            const { data: newThread, error: threadInsErr } = await supabaseAdmin.from("email_threads").insert({
              user_id: user.id,
              account_id,
              provider_thread_id: providerThreadKey,
              subject,
              snippet,
              participants: [sender, recipient].filter(Boolean),
              last_message_at: sentAt,
              message_count: 1,
              unread_count: seenOnServer ? 0 : 1,
              folder: "inbox",
            }).select("id").single();
            if (threadInsErr) {
              if (isUniqueViolation(threadInsErr)) {
                const { data: existingThread } = await supabaseAdmin
                  .from("email_threads")
                  .select("id")
                  .eq("account_id", account_id)
                  .eq("provider_thread_id", providerThreadKey)
                  .maybeSingle();
                threadId = existingThread?.id ?? null;
              } else {
                console.error("imap-sync thread insert:", threadInsErr.message);
                if (uid > lastUid) lastUid = uid;
                continue;
              }
            } else {
              threadId = newThread?.id ?? null;
            }
          }

          if (!threadId) {
            if (uid > lastUid) lastUid = uid;
            continue;
          }
          const { data: inserted, error: insErr } = await supabaseAdmin.from("emails").insert({
            user_id: user.id,
            account_id,
            thread_id: threadId,
            provider_message_id: messageId,
            direction: "inbound",
            rfc_message_id,
            references_header: refsJoined,
            sender,
            sender_name: senderName,
            recipient,
            subject,
            snippet,
            body_text: text,
            body_html: typeof html === "string" ? html : null,
            attachments,
            is_read: seenOnServer,
            sent_at: sentAt,
          }).select("id").single();
          if (insErr || !inserted?.id) {
            console.error("imap-sync email insert:", insErr?.message ?? "missing id");
            if (uid > lastUid) lastUid = uid;
            continue;
          }
          imported++;
          const ageMs = Date.now() - new Date(sentAt).getTime();
          const isRecentInbound = ageMs >= 0 && ageMs < 48 * 60 * 60 * 1000;
          if (isRecentInbound) {
            const fromLabel = senderName ? `${senderName} (${sender})` : sender;
            try {
              await notifyNewInboundEmail(supabaseAdmin, user.id, {
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
          if (uid > lastUid) lastUid = uid;
          } catch (msgErr) {
            const m = msgErr instanceof Error ? msgErr.message : String(msgErr);
            console.error(`imap-sync uid ${uid} failed:`, m);
            if (uid > lastUid) lastUid = uid;
          }
        }
      } finally {
        try {
          lock.release();
        } catch (relErr) {
          console.error("imap-sync mailbox lock release:", relErr instanceof Error ? relErr.message : String(relErr));
        }
      }
    } finally {
      if (connected) await client?.logout().catch(() => {});
    }

    await supabaseAdmin.from("email_accounts").update({
      sync_status: "idle",
      last_synced_at: new Date().toISOString(),
      imap_last_uid: lastUid,
    }).eq("id", account_id);

    return new Response(JSON.stringify({ ok: true, imported, last_uid: lastUid, scanned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("imap-sync error:", msg);
    try {
      if (accountIdForError) {
        const supabaseErr = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await supabaseErr.from("email_accounts").update({
          sync_status: "error",
          last_sync_error: msg.slice(0, 500),
        }).eq("id", accountIdForError);
      }
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

Deno.serve(async (req) => {
  try {
    return await handleImapSync(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("imap-sync uncaught:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
