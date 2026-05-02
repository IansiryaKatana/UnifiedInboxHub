/** RFC 5322 Message-ID / References helpers for Gmail + SMTP parity */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

/** Normalize to angle-bracket form for headers */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (t.startsWith("<") && t.endsWith(">")) return t;
  return `<${t.replace(/^<|>$/g, "")}>`;
}

export function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).trim().toLowerCase() : "localhost";
}

export function generateOutboundMessageId(fromEmail: string): string {
  const domain = domainFromEmail(fromEmail);
  const id = crypto.randomUUID();
  return `<${id}@${domain}>`;
}

/** Build References for a reply: parent References + parent Message-ID */
export function mergeReferences(parentRefs: string | null | undefined, parentMsgId: string | null | undefined): string {
  const pid = normalizeMessageId(parentMsgId ?? null);
  const base = (parentRefs ?? "").trim();
  if (!pid) return base;
  if (!base) return pid;
  return `${base} ${pid}`;
}

export type ParentMailRow = {
  rfc_message_id: string | null;
  references_header: string | null;
};

export type ResolvedThreading = {
  inReplyTo: string;
  references: string;
  outboundMessageId: string;
};

/** Resolve client in_reply_to (UUID of emails row or raw RFC id) + build outbound Message-ID */
export function resolveThreadingForSend(
  inReplyToRaw: string | null | undefined,
  parentRow: ParentMailRow | null,
  fromEmail: string,
): ResolvedThreading {
  const outboundMessageId = generateOutboundMessageId(fromEmail);

  let inReplyHeader = "";
  let references = "";

  if (inReplyToRaw && isUuid(inReplyToRaw)) {
    if (parentRow?.rfc_message_id) {
      const pid = normalizeMessageId(parentRow.rfc_message_id);
      inReplyHeader = pid ?? "";
      references = mergeReferences(parentRow.references_header, parentRow.rfc_message_id);
    }
  } else if (inReplyToRaw) {
    const raw = normalizeMessageId(inReplyToRaw);
    inReplyHeader = raw ?? "";
    references = raw ?? "";
  }

  return {
    inReplyTo: inReplyHeader,
    references,
    outboundMessageId,
  };
}
