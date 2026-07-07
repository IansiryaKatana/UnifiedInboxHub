// Fetch new messages from a custom IMAP mailbox into the unified inbox.
// Uses npm:imapflow which works in Deno via npm: specifier.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { notifyNewInboundEmail } from "../_shared/push-notify.ts";
import { normalizeMailboxPassword } from "../_shared/mail-credentials.ts";
import { normalizeMessageId } from "../_shared/rfc-mail.ts";
import {
  connectImapWithFallbacks,
  CONNECT_BUDGET_MS,
  INCREMENTAL_CONNECT_BUDGET_MS,
  isHostingerFamilyHost,
  smtpHostForImapHost,
} from "../_shared/imap-connect.ts";
import { simpleParser } from "npm:mailparser@3.7.1";
import { Buffer } from "node:buffer";

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
const FIRST_SYNC_CAP = 12;
/** Stop importing before the edge gateway hard-kills the isolate (~150s). */
const SYNC_BUDGET_MS = 18_000;
const INCREMENTAL_SYNC_BUDGET_MS = 12_000;
/** Hard wall clock for a single edge invocation (gateway kills ~150s). */
const WALL_BUDGET_MS = 25_000;
/** Absolute cap — return partial OK before Supabase gateway timeout. */
const GATEWAY_HARD_MS = 28_000;
const PER_MESSAGE_DOWNLOAD_MS = 8_000;
const HOSTINGER_DOWNLOAD_MS = 22_000;

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

const STALE_SYNC_MS = 3 * 60 * 1000;

async function releaseStaleSyncLock(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
): Promise<void> {
  try {
    await supabase
      .from("email_accounts")
      .update({ sync_status: "idle" })
      .eq("id", accountId)
      .eq("sync_status", "syncing");
  } catch {
    /* ignore */
  }
}

async function handleImapSync(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  let accountIdForError: string | undefined;
  let supabaseAdminForCleanup: ReturnType<typeof createClient> | null = null;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    /** Service role only — do not pass user JWT here; mixing JWT + service key can make PostgREST apply RLS oddly. */
    const supabaseAdmin = createClient(url, serviceKey);
    supabaseAdminForCleanup = supabaseAdmin;
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

    const wallStartedAt = Date.now();
    const wallDeadlineAt = wallStartedAt + WALL_BUDGET_MS;

    const body = await req.json().catch(() => ({}));
    const account_id: string | undefined = body.account_id;
    const max_messages = body.max_messages;
    const resume_first_sync = body.resume_first_sync === true;
    const incremental_only = body.incremental_only === true;
    const backfill_older = body.backfill_older === true;
    const force_sync = body.force_sync === true;
    const backfill_seq_to = typeof body.backfill_seq_to === "number" ? body.backfill_seq_to : undefined;
    accountIdForError = account_id;
    if (!account_id) return new Response(JSON.stringify({ error: "account_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: account } = await supabaseAdmin.from("email_accounts").select("*").eq("id", account_id).eq("user_id", user.id).single();
    if (!account || account.provider_type !== "imap") {
      return new Response(JSON.stringify({ error: "IMAP account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!account.imap_host || !account.imap_username || !account.imap_password_encrypted) {
      return new Response(JSON.stringify({ error: "IMAP credentials missing" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (account.sync_status === "disconnected") {
      return new Response(JSON.stringify({ ok: true, imported: 0, skipped: true, reason: "account_disconnected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (account.sync_status === "syncing" && account.updated_at && !force_sync) {
      const age = Date.now() - new Date(account.updated_at).getTime();
      if (age < STALE_SYNC_MS) {
        return new Response(JSON.stringify({ ok: true, imported: 0, skipped: true, reason: "sync_in_progress" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (force_sync && account.sync_status === "syncing") {
      await supabaseAdmin.from("email_accounts").update({ sync_status: "idle" }).eq("id", account_id);
    }

    await supabaseAdmin.from("email_accounts").update({ sync_status: "syncing", last_sync_error: null }).eq("id", account_id);

    const password = normalizeMailboxPassword(decryptPassword(account.imap_password_encrypted));
    if (!password) {
      const errMsg = "IMAP password decrypt failed or is empty. Set IMAP_SECRET_KEY to match the key used when the account was added, or re-save the password in account settings.";
      await supabaseAdmin.from("email_accounts").update({
        sync_status: "error",
        last_sync_error: errMsg.slice(0, 500),
      }).eq("id", account_id);
      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const host = String(account.imap_host).trim();
    const username = String(account.imap_username).trim().toLowerCase();
    const configuredPort = account.imap_port ?? 993;
    const configuredSecure = account.imap_use_tls !== false;
    let priorUid = account.imap_last_uid ?? 0;
    // Checkpoint can advance without imports (timeouts / insert failures). Re-run first-sync window.
    if (priorUid > 0 && !resume_first_sync) {
      const { count: storedEmailCount } = await supabaseAdmin
        .from("emails")
        .select("id", { count: "exact", head: true })
        .eq("account_id", account_id);
      if ((storedEmailCount ?? 0) === 0) {
        priorUid = 0;
        await supabaseAdmin.from("email_accounts").update({ imap_last_uid: null }).eq("id", account_id);
      }
    }
    const isIncrementalPoll = incremental_only && priorUid > 0;

    if (incremental_only && priorUid === 0) {
      return new Response(JSON.stringify({
        ok: true,
        imported: 0,
        skipped: true,
        reason: "awaiting_initial_sync",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    /** Avoid Edge timeouts on first sync; callers can pass max_messages to raise the cap */
    let effectiveMax: number;
    if (isIncrementalPoll) {
      effectiveMax = Math.max(1, Math.min(typeof max_messages === "number" ? max_messages : 8, 15));
    } else if (typeof max_messages === "number") {
      const hostingerCap = isHostingerFamilyHost(host) ? (backfill_older ? 4 : 8) : 500;
      const cap = priorUid === 0 ? Math.min(15, hostingerCap) : hostingerCap;
      effectiveMax = Math.max(1, Math.min(max_messages, cap));
    } else if (priorUid === 0) {
      effectiveMax = FIRST_SYNC_CAP;
    } else {
      effectiveMax = 20;
    }

    const syncBudgetMs = isIncrementalPoll ? INCREMENTAL_SYNC_BUDGET_MS : SYNC_BUDGET_MS;
    const connectBudgetMs = isIncrementalPoll ? INCREMENTAL_CONNECT_BUDGET_MS : CONNECT_BUDGET_MS;

    let client: import("npm:imapflow@1.0.165").ImapFlow | null = null;

    let imported = 0;
    let scanned = 0;
    let failures = 0;
    let firstFailure: string | null = null;
    const noteFailure = (msg: string) => {
      failures += 1;
      if (!firstFailure) firstFailure = msg.slice(0, 300);
    };
    let partial = false;
    let lastUid = priorUid;
    let backfillHasMore = false;
    let nextBackfillSeqTo: number | undefined;
    let mailboxTotal: number | undefined;
    const forceFirstSync = priorUid === 0 && (account.imap_last_uid ?? 0) > 0;
    let connectedHost = host;
    let connectedPort = configuredPort;
    let connectedSecure = configuredSecure;

    try {
      const connected = await connectImapWithFallbacks(
        host,
        configuredPort,
        configuredSecure,
        username,
        password,
        {
          connectBudgetMs,
          wallDeadlineAt,
          incrementalOnly: isIncrementalPoll,
        },
      );
      client = connected.client;
      connectedHost = connected.host;
      connectedPort = connected.port;
      connectedSecure = connected.secure;

      if (connectedHost !== host || connectedPort !== configuredPort || connectedSecure !== configuredSecure) {
        const smtpHost = smtpHostForImapHost(connectedHost);
        await supabaseAdmin.from("email_accounts").update({
          imap_host: connectedHost,
          imap_port: connectedPort,
          imap_use_tls: connectedSecure,
          smtp_host: smtpHost,
        }).eq("id", account_id);
      }
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uidFlags = new Map<number, Set<string>>();
        const uidEnvelopeIds = new Map<number, string | null>();
        let newUids: number[];

        const rememberMsg = (msg: { uid: number; flags?: Set<string> | string[]; envelope?: { messageId?: string } }) => {
          uidFlags.set(msg.uid, msg.flags ? new Set(msg.flags) : new Set());
          const mid = msg.envelope?.messageId ? normalizeMessageId(msg.envelope.messageId) : null;
          uidEnvelopeIds.set(msg.uid, mid);
        };

        const isAlreadyImported = async (uid: number): Promise<boolean> => {
          const envelopeMid = uidEnvelopeIds.get(uid) ?? null;
          if (envelopeMid) {
            const { data } = await supabaseAdmin
              .from("emails")
              .select("id")
              .eq("account_id", account_id)
              .eq("rfc_message_id", envelopeMid)
              .maybeSingle();
            if (data?.id) return true;
          }
          const { data: byProvider } = await supabaseAdmin
            .from("emails")
            .select("id")
            .eq("account_id", account_id)
            .eq("provider_message_id", `imap-${account_id}-${uid}`)
            .maybeSingle();
          return !!byProvider?.id;
        };

        if (backfill_older && !resume_first_sync && !forceFirstSync) {
          const status = await client.status("INBOX", { messages: true });
          const msgCount = status.messages ?? 0;
          mailboxTotal = msgCount;
          const seqTo = backfill_seq_to !== undefined
            ? Math.min(Math.max(1, backfill_seq_to), msgCount)
            : msgCount;
          const window = effectiveMax;
          const seqFrom = Math.max(1, seqTo - window + 1);
          const uids: number[] = [];
          for await (const msg of client.fetch(`${seqFrom}:${seqTo}`, { uid: true, flags: true, envelope: true })) {
            if (Date.now() >= wallDeadlineAt) {
              partial = true;
              break;
            }
            rememberMsg(msg);
            uids.push(msg.uid);
          }
          newUids = uids.sort((a, b) => a - b);
          if (seqFrom > 1) {
            backfillHasMore = true;
            nextBackfillSeqTo = seqFrom - 1;
          }
        } else if (lastUid > 0 && !resume_first_sync && !forceFirstSync) {
          const uids: number[] = [];
          const hostingerIncremental = isIncrementalPoll && isHostingerFamilyHost(host);

          if (hostingerIncremental) {
            // Hostinger UID-range poll can miss new mail — always sweep recent sequence numbers.
            const status = await client.status("INBOX", { messages: true });
            const msgCount = status.messages ?? 0;
            mailboxTotal = msgCount;
            const seqFrom = Math.max(1, msgCount - 14);
            for await (const msg of client.fetch(`${seqFrom}:*`, { uid: true, flags: true, envelope: true })) {
              if (Date.now() >= wallDeadlineAt) {
                partial = true;
                break;
              }
              if (msg.uid > lastUid) {
                rememberMsg(msg);
                uids.push(msg.uid);
              }
            }
            newUids = [...new Set(uids)].sort((a, b) => a - b);
          } else {
            const range = `${lastUid + 1}:*`;
            for await (const msg of client.fetch(range, { uid: true, flags: true, envelope: true }, { uid: true })) {
              if (Date.now() >= wallDeadlineAt) {
                partial = true;
                break;
              }
              rememberMsg(msg);
              uids.push(msg.uid);
              if (uids.length >= effectiveMax) break;
            }
            newUids = uids.sort((a, b) => a - b);
          }

          // Fallback when primary UID poll found nothing — scan recent sequence numbers.
          if (isIncrementalPoll && newUids.length === 0) {
            const status = await client.status("INBOX", { messages: true });
            const msgCount = status.messages ?? 0;
            mailboxTotal = msgCount;
            if (msgCount > 0) {
              const seqFrom = Math.max(1, msgCount - 9);
              const catchupUids: number[] = [];
              for await (const msg of client.fetch(`${seqFrom}:*`, { uid: true, flags: true, envelope: true })) {
                if (Date.now() >= wallDeadlineAt) break;
                if (msg.uid > lastUid) {
                  rememberMsg(msg);
                  catchupUids.push(msg.uid);
                }
              }
              newUids = [...new Set(catchupUids)].sort((a, b) => a - b).slice(0, effectiveMax);
            }
          }
        } else {
          // First sync (or resume): scan only the most recent messages in the mailbox.
          const status = await client.status("INBOX", { messages: true });
          const msgCount = status.messages ?? 0;
          mailboxTotal = msgCount;
          const recentWindow = Math.min(effectiveMax, priorUid === 0 && !resume_first_sync ? 12 : 50);
          const seqFrom = Math.max(1, msgCount - recentWindow + 1);
          const uids: number[] = [];
          for await (const msg of client.fetch(`${seqFrom}:*`, { uid: true, flags: true, envelope: true })) {
            if (Date.now() >= wallDeadlineAt) {
              partial = true;
              break;
            }
            rememberMsg(msg);
            uids.push(msg.uid);
            if (uids.length >= effectiveMax) break;
          }
          const resumeFrom = resume_first_sync ? (account.imap_last_uid ?? 0) : 0;
          newUids = uids.sort((a, b) => a - b).filter((uid) => uid > resumeFrom);
        }

        const toProcess = newUids.slice(0, effectiveMax);

        scanned = toProcess.length;
        const syncStartedAt = Date.now();
        let processedSinceCheckpoint = 0;
        let lastCheckpointUid = lastUid;
        let successfulBodyFetches = 0;

        const checkpointProgress = async () => {
          if (lastUid <= lastCheckpointUid || successfulBodyFetches === 0) return;
          await supabaseAdmin.from("email_accounts").update({
            imap_last_uid: lastUid,
            last_synced_at: new Date().toISOString(),
          }).eq("id", account_id);
          lastCheckpointUid = lastUid;
          processedSinceCheckpoint = 0;
          successfulBodyFetches = 0;
        };

        for (const uid of toProcess) {
          if (Date.now() - syncStartedAt > syncBudgetMs || Date.now() >= wallDeadlineAt) {
            partial = true;
            break;
          }
          try {
          if (await isAlreadyImported(uid)) {
            if (uid > lastUid) lastUid = uid;
            processedSinceCheckpoint++;
            if (processedSinceCheckpoint >= 3) await checkpointProgress();
            continue;
          }
          const flagSet = uidFlags.get(uid);
          const seenOnServer = isImapSeen(flagSet);
          if (Date.now() >= wallDeadlineAt) {
            partial = true;
            break;
          }
          const downloadBudgetMs = isHostingerFamilyHost(host)
            ? Math.min(HOSTINGER_DOWNLOAD_MS, Math.max(5_000, wallDeadlineAt - Date.now() - 1_500))
            : Math.min(PER_MESSAGE_DOWNLOAD_MS, Math.max(3_000, wallDeadlineAt - Date.now() - 1_500));
          const { content } = await Promise.race([
            client.download(uid.toString(), undefined, { uid: true }),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("message download timed out")), downloadBudgetMs);
            }),
          ]);
          const chunks: Uint8Array[] = [];
          let downloadTimedOut = false;
          for await (const chunk of content) {
            if (Date.now() >= wallDeadlineAt) {
              partial = true;
              downloadTimedOut = true;
              break;
            }
            chunks.push(chunk);
          }
          if (downloadTimedOut) break;
          const buffer = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let off = 0;
          for (const c of chunks) { buffer.set(c, off); off += c.length; }
          if (buffer.byteLength === 0) {
            console.warn(`imap-sync uid ${uid}: empty body, skipping`);
            noteFailure("empty message body");
            continue;
          }
          successfulBodyFetches += 1;
          const parsed = await simpleParser(Buffer.from(buffer));

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
            processedSinceCheckpoint++;
            if (processedSinceCheckpoint >= 3) await checkpointProgress();
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
                noteFailure(`thread: ${threadInsErr.message}`);
                continue;
              }
            } else {
              threadId = newThread?.id ?? null;
            }
          }

          if (!threadId) {
            noteFailure("thread: missing thread id after insert");
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
            const insMsg = insErr?.message ?? "missing id";
            console.error("imap-sync email insert:", insMsg);
            noteFailure(`email: ${insMsg}`);
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
          processedSinceCheckpoint++;
          if (processedSinceCheckpoint >= 3) {
            await checkpointProgress();
          }
          } catch (msgErr) {
            const m = msgErr instanceof Error ? msgErr.message : String(msgErr);
            console.error(`imap-sync uid ${uid} failed:`, m);
            noteFailure(m);
            if (/download timed out/i.test(m)) partial = true;
          }
        }
        if (partial) await checkpointProgress();
        if (backfill_older && backfillHasMore && !partial) partial = true;
      } finally {
        try {
          lock.release();
        } catch (relErr) {
          console.error("imap-sync mailbox lock release:", relErr instanceof Error ? relErr.message : String(relErr));
        }
      }
    } finally {
      if (client) await client.logout().catch(() => {});
    }

    const syncError = !partial && imported === 0 && scanned > 0
      ? (firstFailure
        ? `Imported 0/${scanned} messages. ${firstFailure}`
        : `Scanned ${scanned} messages but none were imported (empty or unparseable).`)
      : null;

    const accountUpdate: Record<string, unknown> = {
      sync_status: "idle",
      last_synced_at: new Date().toISOString(),
      imap_last_uid: lastUid > 0 ? lastUid : null,
    };
    if (syncError) accountUpdate.last_sync_error = syncError.slice(0, 500);
    else if (imported > 0) accountUpdate.last_sync_error = null;

    await supabaseAdmin.from("email_accounts").update(accountUpdate).eq("id", account_id);

    return new Response(JSON.stringify({
      ok: true,
      imported,
      last_uid: lastUid,
      scanned,
      failures,
      first_failure: firstFailure,
      partial,
      resume_first_sync: partial && (priorUid === 0 || resume_first_sync),
      backfill_has_more: backfillHasMore,
      backfill_seq_to: nextBackfillSeqTo,
      mailbox_total: mailboxTotal && mailboxTotal > 0 ? mailboxTotal : undefined,
    }), {
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
    const isConnectFailure = /imap connect failed|establish connection|upgrade connection|authentication failed|invalid credentials|auth/i.test(msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: isConnectFailure ? 400 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (accountIdForError && supabaseAdminForCleanup) {
      await releaseStaleSyncLock(supabaseAdminForCleanup, accountIdForError);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const startedAt = Date.now();
  const handler = handleImapSync(req).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("imap-sync uncaught:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  });
  const hardTimeout = new Promise<Response>((resolve) => {
    setTimeout(() => {
      console.warn(`imap-sync gateway_wall at ${Date.now() - startedAt}ms`);
      resolve(new Response(JSON.stringify({
        ok: true,
        imported: 0,
        partial: true,
        reason: "gateway_wall",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }));
    }, GATEWAY_HARD_MS);
  });
  return await Promise.race([handler, hardTimeout]);
});
