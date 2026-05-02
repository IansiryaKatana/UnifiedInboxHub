import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { AccountBadge } from "./AccountBadge";
import { Button } from "@/components/ui/button";
import { Reply, Forward, Archive, Trash2, Star, MoreHorizontal, Send, Lock, X, ArrowLeft, Paperclip, Mail, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ComposeRichEditor } from "./ComposeRichEditor.tsx";
import { Progress } from "@/components/ui/progress";
import { htmlToText, escapeHtml } from "@/lib/email-html";
import { uploadOutboundAttachment, type OutboundAttachment } from "@/lib/mail-attachments";
import { createSignedAttachmentUrl } from "@/lib/storage-sign";
import { enqueueOutboxSend, shouldQueueSendFailure } from "@/lib/outbox-queue";

interface EmailMsg {
  id: string;
  thread_id?: string | null;
  is_starred?: boolean;
  direction: "inbound" | "outbound";
  sender: string;
  sender_name: string | null;
  recipient: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments?: {
    filename: string;
    mime_type: string;
    size: number;
    inline: boolean;
    content_id: string | null;
    data_base64: string | null;
    storage_path?: string | null;
  }[] | null;
  sent_at: string;
}

interface Account {
  id: string;
  email_address: string;
  color: string;
  display_name: string | null;
  provider_type: string;
}

interface Props {
  threadId: string | null;
  thread?: { has_starred?: boolean; folder?: string } | null;
  account: Account | null;
  onAfterAction: () => void;
  onBack?: () => void;
}

export function ThreadView({ threadId, thread, account, onAfterAction, onBack }: Props) {
  const renderEmailHtml = (rawHtml: string) => {
    const cleaned = rawHtml
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
      .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
    return cleaned;
  };

  const attachmentLabel = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };
  const { user } = useAuth();
  const [messages, setMessages] = useState<EmailMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [composerMode, setComposerMode] = useState<"reply" | "forward" | null>(null);
  const [replyBodyHtml, setReplyBodyHtml] = useState("");
  const [forwardBodyHtml, setForwardBodyHtml] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<OutboundAttachment[]>([]);
  const [forwardAttachments, setForwardAttachments] = useState<OutboundAttachment[]>([]);
  const [attachProgress, setAttachProgress] = useState<{ done: number; total: number; mode: "reply" | "forward" } | null>(
    null,
  );
  const [composerEditorKey, setComposerEditorKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [starringId, setStarringId] = useState<string | null>(null);
  const [acting, setActing] = useState<"archive" | "trash" | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  /** `${messageId}-${attachmentIndex}` → signed download URL */
  const [signedAttachmentUrls, setSignedAttachmentUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setComposerMode(null);
    setReplyBodyHtml("");
    setForwardBodyHtml("");
    setForwardTo("");
    setReplyAttachments([]);
    setForwardAttachments([]);
    setComposerEditorKey((k) => k + 1);

    supabase
      .from("emails")
      .select("*")
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true })
      .then(({ data }) => {
        setMessages((data ?? []) as EmailMsg[]);
        setLoading(false);
        supabase.from("emails").update({ is_read: true }).eq("thread_id", threadId).then(() => {});
        supabase.from("email_threads").update({ unread_count: 0 }).eq("id", threadId).then(() => {
          onAfterAction();
        });
      });
  }, [threadId]);

  useEffect(() => {
    if (!threadId || messages.length === 0) return;
    const raw = sessionStorage.getItem("inbox-reply-draft");
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as {
        context_thread_id?: string;
        kind?: string;
        reply_body_html?: string;
        forward_body_html?: string;
        forward_to?: string;
        attachments?: OutboundAttachment[];
      };
      if (d.context_thread_id !== threadId) return;
      if (d.kind === "reply") {
        setComposerMode("reply");
        if (d.reply_body_html) setReplyBodyHtml(d.reply_body_html);
        if (Array.isArray(d.attachments)) setReplyAttachments(d.attachments);
      } else if (d.kind === "forward") {
        setComposerMode("forward");
        if (d.forward_to) setForwardTo(d.forward_to);
        if (d.forward_body_html) setForwardBodyHtml(d.forward_body_html);
        if (Array.isArray(d.attachments)) setForwardAttachments(d.attachments);
      }
      setComposerEditorKey((k) => k + 1);
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem("inbox-reply-draft");
  }, [threadId, messages.length]);

  useEffect(() => {
    setSignedAttachmentUrls({});
    if (!threadId || messages.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const m of messages) {
        if (m.thread_id != null && m.thread_id !== threadId) continue;
        const atts = m.attachments ?? [];
        for (let idx = 0; idx < atts.length; idx++) {
          const att = atts[idx]!;
          if (att.data_base64) continue;
          const path = att.storage_path;
          if (!path) continue;
          const key = `${m.id}-${idx}`;
          const url = await createSignedAttachmentUrl(path);
          if (!cancelled && url) next[key] = url;
        }
      }
      if (!cancelled) setSignedAttachmentUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, messages]);

  if (!threadId) {
    return (
      <div className="flex-1 grid place-items-center bg-muted/20">
        <div className="text-center text-muted-foreground">
          <div className="size-16 mx-auto mb-4 rounded-2xl bg-muted grid place-items-center">
            <Reply className="size-7" />
          </div>
          <p className="text-sm">Select an email to read</p>
        </div>
      </div>
    );
  }

  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const replyTo = lastInbound?.sender ?? messages[0]?.sender ?? "";
  const subject = messages[0]?.subject ?? "(no subject)";
  const forwardSubject = subject.startsWith("Fwd: ") ? subject : `Fwd: ${subject}`;
  const latestBody = lastInbound?.body_text ?? messages[messages.length - 1]?.body_text ?? "";

  const pickFiles = async (files: FileList | null, mode: "reply" | "forward") => {
    if (!files?.length) return;
    const list = Array.from(files).filter((file) => {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 10MB.`);
        return false;
      }
      return true;
    });
    if (!list.length) return;
    setAttachProgress({ done: 0, total: list.length, mode });
    const next: OutboundAttachment[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      try {
        if (!user?.id) throw new Error("Not signed in");
        const uploaded = await uploadOutboundAttachment(supabase, user.id, file);
        next.push(uploaded);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to attach file");
      }
      setAttachProgress({ done: i + 1, total: list.length, mode });
    }
    setAttachProgress(null);
    const setter = mode === "reply" ? setReplyAttachments : setForwardAttachments;
    setter((prev) => [...prev, ...next].slice(0, 10));
  };

  const openForwardComposer = () => {
    const quoted = latestBody
      ? `\n\n---------- Forwarded message ----------\nFrom: ${replyTo}\nSubject: ${subject}\n\n${latestBody}`
      : "";
    const escaped = escapeHtml(quoted);
    setForwardBodyHtml(`<p>${escaped.replace(/\n/g, "<br>")}</p>`);
    setComposerMode("forward");
    setComposerEditorKey((k) => k + 1);
  };

  const handleSend = async () => {
    if (!account || !user || !threadId) return;

    const isForward = composerMode === "forward";
    const to = isForward ? forwardTo.trim() : replyTo;
    const outgoingHtml = isForward ? forwardBodyHtml : replyBodyHtml;
    const outgoingText = htmlToText(outgoingHtml);
    const attachments = isForward ? forwardAttachments : replyAttachments;

    if (!to) {
      toast.error(isForward ? "Recipient is required." : "Missing recipient.");
      return;
    }
    if (!outgoingText) {
      toast.error("Message is required.");
      return;
    }

    const replySubject = isForward ? forwardSubject : subject.startsWith("Re: ") ? subject : `Re: ${subject}`;
    const lastMsgId = lastInbound?.id;

    if (!["gmail", "imap"].includes(account.provider_type)) {
      toast.error(`Unsupported account provider: ${account.provider_type}`);
      return;
    }

    setSending(true);

    const fnName = account.provider_type === "gmail" ? "gmail-send" : "smtp-send";
    const invokeBody = {
      account_id: account.id,
      thread_id: threadId,
      to,
      subject: replySubject,
      body_text: outgoingText,
      html_body: outgoingHtml,
      attachments,
      in_reply_to: isForward ? null : lastMsgId,
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueOutboxSend({ fnName, body: invokeBody });
      toast.info("You are offline — message queued. It will send when you reconnect.");
      setSending(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke(fnName, { body: invokeBody });
    const res = data as { ok?: boolean; error?: string; code?: string } | null;

    if (error || !res?.ok) {
      const errObj = error ?? new Error(res?.error ?? "Send failed");
      if (shouldQueueSendFailure({ error: errObj, responseCode: res?.code })) {
        enqueueOutboxSend({ fnName, body: invokeBody });
        toast.info("Could not reach the server — message queued to send later.");
        setSending(false);
        return;
      }
      setSending(false);
      let msg = res?.error ?? error?.message ?? "unknown";
      if (res?.code === "RECONNECT_GMAIL") {
        msg = "Gmail authorization expired. Reconnect the account under Accounts → settings.";
      } else if (res?.code === "CHECK_SMTP") {
        msg = "SMTP failed. Verify SMTP host, port, and credentials in account settings.";
      }
      toast.error(`Send failed: ${msg}`);
      return;
    }

    toast.success(`${isForward ? "Forward" : "Reply"} sent from ${account.email_address}`);
    setSending(false);
    setComposerMode(null);
    setReplyBodyHtml("");
    setForwardBodyHtml("");
    setForwardTo("");
    setReplyAttachments([]);
    setForwardAttachments([]);
    setComposerEditorKey((k) => k + 1);

    const { data: draftRows } = await supabase
      .from("email_threads")
      .select("id, draft_content")
      .eq("user_id", user.id)
      .eq("folder", "drafts");
    const draftIds =
      draftRows
        ?.filter((row) => {
          const c = row.draft_content as Record<string, unknown> | null;
          return (
            c?.context_thread_id === threadId &&
            (c?.kind === "reply" || c?.kind === "forward")
          );
        })
        .map((r) => r.id) ?? [];
    if (draftIds.length > 0) {
      await supabase.from("email_threads").delete().in("id", draftIds);
    }

    const { data: refreshedMessages } = await supabase.from("emails").select("*").eq("thread_id", threadId).order("sent_at", { ascending: true });
    setMessages((refreshedMessages ?? []) as EmailMsg[]);
    onAfterAction();
  };

  const markThreadUnread = async () => {
    if (!threadId) return;
    await supabase.from("emails").update({ is_read: false }).eq("thread_id", threadId);
    const n = messages.length || 1;
    await supabase.from("email_threads").update({ unread_count: n }).eq("id", threadId);
    toast.success("Marked as unread");
    onAfterAction();
    onBack?.();
  };

  const toggleMessageStar = async (messageId: string, next: boolean) => {
    setStarringId(messageId);
    const { error } = await supabase.from("emails").update({ is_starred: next }).eq("id", messageId);
    setStarringId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, is_starred: next } : m)));
    onAfterAction();
  };

  const saveComposerDraft = async () => {
    if (!user || !account || !threadId || !composerMode) return;
    setSavingDraft(true);
    try {
      const kind = composerMode;
      const draftBody = kind === "forward" ? forwardBodyHtml : replyBodyHtml;
      const snippet = htmlToText(draftBody).slice(0, 140) || "(draft)";
      const payload = {
        version: 1 as const,
        kind,
        context_thread_id: threadId,
        account_id: account.id,
        reply_body_html: replyBodyHtml,
        forward_body_html: forwardBodyHtml,
        forward_to: forwardTo,
        attachments: composerAttachments,
        subject,
      };
      const { data: drafts } = await supabase
        .from("email_threads")
        .select("id, draft_content")
        .eq("user_id", user.id)
        .eq("folder", "drafts")
        .limit(120);
      const existing = drafts?.find((row) => {
        const c = row.draft_content as Record<string, unknown> | null;
        return c?.context_thread_id === threadId && c?.kind === kind;
      });
      if (existing?.id) {
        const { error } = await supabase
          .from("email_threads")
          .update({
            snippet,
            last_message_at: new Date().toISOString(),
            draft_content: payload,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("email_threads").insert({
          user_id: user.id,
          account_id: account.id,
          folder: "drafts",
          subject: kind === "forward" ? `Fwd: ${subject}` : `Re: ${subject}`,
          participants: [account.email_address, replyTo].filter(Boolean),
          last_message_at: new Date().toISOString(),
          message_count: 0,
          unread_count: 0,
          snippet,
          draft_content: payload,
        });
        if (error) throw error;
      }
      toast.success("Draft saved");
      onAfterAction();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const moveThread = async (folder: "archive" | "trash") => {
    if (!threadId) return;
    setActing(folder);
    const { error } = await supabase.from("email_threads").update({ folder }).eq("id", threadId);
    setActing(null);
    if (error) {
      toast.error(`Failed to move thread: ${error.message}`);
      return;
    }
    toast.success(folder === "archive" ? "Moved to Archive" : "Moved to Trash");
    onAfterAction();
    onBack?.();
  };

  const closeComposer = () => {
    setComposerMode(null);
    setReplyBodyHtml("");
    setForwardBodyHtml("");
    setForwardTo("");
    setReplyAttachments([]);
    setForwardAttachments([]);
    setComposerEditorKey((k) => k + 1);
  };

  const composerAttachments = composerMode === "forward" ? forwardAttachments : replyAttachments;
  const setComposerAttachments = composerMode === "forward" ? setForwardAttachments : setReplyAttachments;

  return (
    <div className="flex-1 flex flex-col h-full bg-background min-w-0">
      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-border flex items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center md:items-start gap-2 min-w-0 flex-1">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden mt-0.5 size-8 -ml-1 rounded-md grid place-items-center hover:bg-muted shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <div className="min-w-0 flex-1 text-center md:text-left">
            <h2 className="text-base md:text-xl font-semibold truncate">{subject}</h2>
            {account && (
              <div className="mt-1 md:mt-1.5 flex justify-center md:justify-start">
                <AccountBadge email={account.email_address} color={account.color} size="md" />
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 md:gap-1 shrink-0">
          <Button variant="ghost" size="icon" aria-label="Mark as unread" onClick={() => void markThreadUnread()} className="hidden sm:inline-flex">
            <Mail className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Archive"
            className="hidden sm:inline-flex"
            onClick={() => moveThread("archive")}
            disabled={acting !== null || thread?.folder === "archive"}
          >
            <Archive className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            className="hidden sm:inline-flex"
            onClick={() => moveThread("trash")}
            disabled={acting !== null || thread?.folder === "trash"}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="More" onClick={() => setMobileActionsOpen(true)} className="md:hidden">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>
      <Sheet open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
        <SheetContent side="bottom" className="h-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Message actions</SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => {
                void markThreadUnread();
                setMobileActionsOpen(false);
              }}
            >
              <Mail className="size-4" />
              Mark as unread
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => {
                void moveThread("archive");
                setMobileActionsOpen(false);
              }}
              disabled={acting !== null || thread?.folder === "archive"}
            >
              <Archive className="size-4" />
              Archive
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => {
                setComposerMode("reply");
                setMobileActionsOpen(false);
              }}
            >
              <Reply className="size-4" />
              Reply
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => {
                openForwardComposer();
                setMobileActionsOpen(false);
              }}
            >
              <Forward className="size-4" />
              Forward
            </Button>
            <Button
              variant="destructive"
              className="justify-start gap-2"
              onClick={() => {
                void moveThread("trash");
                setMobileActionsOpen(false);
              }}
              disabled={acting !== null || thread?.folder === "trash"}
            >
              <Trash2 className="size-4" />
              Move to trash
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 md:px-6 py-4 md:py-6 space-y-4 min-w-0">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {messages.map((m) => (
          <article key={m.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <header className="px-3 md:px-5 py-3 md:py-4 border-b border-border bg-muted/30 flex items-start justify-between gap-2 md:gap-4">
              <div className="flex items-start gap-2 md:gap-3 min-w-0 flex-1">
                <div className="size-8 md:size-9 rounded-full bg-primary/10 grid place-items-center text-sm font-semibold text-primary shrink-0">
                  {(m.sender_name ?? m.sender)[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{m.sender_name ?? m.sender}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.direction === "outbound" ? "from " : ""}
                    {m.sender} → {m.recipient}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={m.is_starred ? "Unstar message" : "Star message"}
                  disabled={starringId === m.id}
                  onClick={() => void toggleMessageStar(m.id, !m.is_starred)}
                >
                  <Star className={`size-4 ${m.is_starred ? "fill-current text-amber-600" : ""}`} />
                </Button>
                <span className="text-[11px] md:text-xs text-muted-foreground tabular-nums">{format(new Date(m.sent_at), "MMM d, h:mm a")}</span>
              </div>
            </header>
            <div className="px-3 md:px-5 py-3 md:py-4">
              {m.body_html ? (
                <div className="email-html" dangerouslySetInnerHTML={{ __html: renderEmailHtml(m.body_html) }} />
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 break-words">{m.body_text || "(empty)"}</p>
              )}
              {(m.attachments ?? []).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/70">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Attachments</p>
                  <div className="flex flex-wrap gap-2">
                    {(m.attachments ?? []).map((att, idx) => {
                      const urlKey = `${m.id}-${idx}`;
                      const signed = signedAttachmentUrls[urlKey];
                      const canOpen = Boolean(att.data_base64) || Boolean(signed);
                      const href = att.data_base64
                        ? `data:${att.mime_type};base64,${att.data_base64}`
                        : signed || "#";
                      return (
                        <a
                          key={`${m.id}-att-${idx}`}
                          href={href}
                          download={att.filename || "attachment"}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => {
                            if (!canOpen) {
                              e.preventDefault();
                              toast.error(
                                att.storage_path
                                  ? "Could not load this attachment. Try again or re-sync the message."
                                  : "This attachment is too large to preview inline. Re-sync with smaller message batch or fetch on-demand flow.",
                              );
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/50"
                        >
                          <span className="truncate max-w-[200px]">{att.filename || "attachment"}</span>
                          <span className="text-muted-foreground">{attachmentLabel(att.size ?? 0)}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="border-t border-border p-4 bg-background">
        {composerMode === null ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setComposerMode("reply")} className="gap-2">
              <Reply className="size-4" /> Reply
            </Button>
            <Button variant="outline" className="gap-2" onClick={openForwardComposer}>
              <Forward className="size-4" /> Forward
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden flex flex-col max-h-[min(70vh,520px)]">
            <div className="px-4 py-2.5 bg-muted/50 border-b border-border flex items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-muted-foreground">From</span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-background border border-border font-medium">
                  <Lock className="size-3 text-primary" />
                  {account?.email_address}
                </span>
                <span className="text-muted-foreground">to</span>
                {composerMode === "forward" ? (
                  <input
                    value={forwardTo}
                    onChange={(e) => setForwardTo(e.target.value)}
                    placeholder="recipient@example.com"
                    className="h-7 rounded border border-border bg-background px-2 text-xs sm:text-sm min-w-[200px]"
                  />
                ) : (
                  <span className="font-medium">{replyTo}</span>
                )}
              </div>
              <button onClick={closeComposer} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Close composer" type="button">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ComposeRichEditor
                key={`${composerMode}-${composerEditorKey}`}
                value={composerMode === "forward" ? forwardBodyHtml : replyBodyHtml}
                onChange={composerMode === "forward" ? setForwardBodyHtml : setReplyBodyHtml}
                placeholder={composerMode === "forward" ? "Write your forwarded message…" : "Write your reply…"}
                disabled={sending}
                className="compose-editor border-0 rounded-none"
              />
            </div>
            {attachProgress && attachProgress.mode === composerMode && (
              <div className="px-4 py-2 border-t border-border space-y-1">
                <p className="text-xs text-muted-foreground">
                  Attaching file {attachProgress.done} of {attachProgress.total}…
                </p>
                <Progress value={(attachProgress.done / attachProgress.total) * 100} className="h-2" />
              </div>
            )}
            <div className="px-4 py-2 border-t border-border space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs sm:text-sm cursor-pointer hover:bg-muted/40 w-fit">
                  <Paperclip className="size-4 shrink-0" />
                  Attach files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={sending || Boolean(attachProgress)}
                    onChange={(e) => {
                      if (composerMode) void pickFiles(e.target.files, composerMode);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              {composerAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {composerAttachments.map((file, idx) => (
                    <span
                      key={`${file.filename}-${idx}`}
                      className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs bg-muted/20"
                    >
                      <span className="max-w-[140px] sm:max-w-[180px] truncate">{file.filename}</span>
                      <span className="text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                      <button
                        type="button"
                        onClick={() => setComposerAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Remove attachment"
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-background shrink-0">
              <p className="text-[11px] text-muted-foreground">
                {composerMode === "forward"
                  ? "Forwards are sent from the selected inbox address."
                  : "Replies are always sent from the address that received the email."}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={sending || savingDraft}
                  onClick={() => void saveComposerDraft()}
                  className="gap-2"
                >
                  {savingDraft ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {savingDraft ? "Saving…" : "Save draft"}
                </Button>
                <Button
                  onClick={() => void handleSend()}
                  disabled={
                    sending ||
                    savingDraft ||
                    (composerMode === "forward"
                      ? !forwardTo.trim() || !htmlToText(forwardBodyHtml)
                      : !htmlToText(replyBodyHtml))
                  }
                  className="gap-2"
                >
                  <Send className="size-4" /> {sending ? "Sending…" : composerMode === "forward" ? "Forward" : "Send"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
