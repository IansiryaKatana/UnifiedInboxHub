const PRETTY: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFT: "Drafts",
  TRASH: "Trash",
  SPAM: "Spam",
  STARRED: "Starred",
  UNREAD: "Unread",
  IMPORTANT: "Important",
  CHAT: "Chat",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
};

/** Readable label for Gmail API label id (system or user label id left as-is if unknown). */
export function formatGmailLabelId(id: string): string {
  if (PRETTY[id]) return PRETTY[id];
  if (id.startsWith("Label_")) return id.replace(/^Label_/, "Label ");
  return id
    .replace(/^CATEGORY_/, "")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
