/**
 * Server-side Web Push for new inbound email (VAPID).
 * Called from gmail-sync / imap-sync after a successful insert.
 */
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface NewEmailPushPayload {
  emailId: string;
  threadId: string;
  subject: string | null;
  snippet: string | null;
  from: string;
}

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  const subject = Deno.env.get("VAPID_SUBJECT")?.trim() || "mailto:support@replyspot.app";
  if (!publicKey || !privateKey) {
    console.warn("push-notify: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set; skipping web push");
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export async function notifyNewInboundEmail(
  supabase: SupabaseClient,
  userId: string,
  payload: NewEmailPushPayload,
): Promise<void> {
  if (!ensureVapid()) return;

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    console.error("push-notify: load subscriptions", error.message);
    return;
  }
  if (!subs?.length) return;

  const body = JSON.stringify({
    title: payload.subject?.trim() || "(no subject)",
    body: `${payload.from}: ${(payload.snippet ?? "").slice(0, 160)}`,
    url: `/?thread=${payload.threadId}`,
    threadId: payload.threadId,
    emailId: payload.emailId,
  });

  for (const row of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body,
        {
          TTL: 86_400,
          urgency: "normal",
        },
      );
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 410 || status === 404) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
      } else {
        console.error("push-notify: send failed", e);
      }
    }
  }
}
