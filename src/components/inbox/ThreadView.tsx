import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { AccountBadge } from "./AccountBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Reply, Forward, Archive, Trash2, Star, MoreHorizontal, Send, Lock, X, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface EmailMsg {
  id: string;
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
  const [replyBody, setReplyBody] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [forwardBody, setForwardBody] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<"star" | "archive" | "trash" | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setComposerMode(null);
    setReplyBody("");
    setForwardTo("");
    setForwardBody("");

    supabase
      .from("emails")
      .select("*")
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true })
      .then(({ data }) => {
        setMessages((data ?? []) as EmailMsg[]);
        setLoading(false);
        // Mark thread + emails as read
        supabase.from("emails").update({ is_read: true }).eq("thread_id", threadId).then(() => {});
        supabase.from("email_threads").update({ unread_count: 0 }).eq("id", threadId).then(() => {
          onAfterAction();
        });
      });
  }, [threadId]);

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

  const lastInbound = [...messages].reverse().find(m => m.direction === "inbound");
  const replyTo = lastInbound?.sender ?? messages[0]?.sender ?? "";
  const subject = messages[0]?.subject ?? "(no subject)";
  const forwardSubject = subject.startsWith("Fwd: ") ? subject : `Fwd: ${subject}`;
  const latestBody = lastInbound?.body_text ?? messages[messages.length - 1]?.body_text ?? "";

  const openForwardComposer = () => {
    const quoted = latestBody
      ? `\n\n---------- Forwarded message ----------\nFrom: ${replyTo}\nSubject: ${subject}\n\n${latestBody}`
      : "";
    setForwardBody(quoted);
    setComposerMode("forward");
  };

  const handleSend = async () => {
    if (!account || !user || !threadId || !replyBody.trim() || !replyTo) return;
    setSending(true);

    const isForward = composerMode === "forward";
    const to = isForward ? forwardTo.trim() : replyTo;
    const outgoingBody = isForward ? forwardBody.trim() : replyBody.trim();
    if (!to || !outgoingBody) {
      toast.error("Recipient and message are required.");
      setSending(false);
      return;
    }

    const replySubject = isForward
      ? forwardSubject
      : (subject.startsWith("Re: ") ? subject : `Re: ${subject}`);
    const lastMsgId = lastInbound?.id;

    if (!["gmail", "imap"].includes(account.provider_type)) {
      setSending(false);
      toast.error(`Unsupported account provider: ${account.provider_type}`);
      return;
    }

    const fnName = account.provider_type === "gmail" ? "gmail-send" : "smtp-send";
    const { data, error } = await supabase.functions.invoke(fnName, {
      body: {
        account_id: account.id,
        thread_id: threadId,
        to,
        subject: replySubject,
        body_text: outgoingBody,
        in_reply_to: isForward ? null : lastMsgId,
      },
    });
    if (error || !data?.ok) {
      setSending(false);
      toast.error("Send failed: " + (error?.message ?? data?.error ?? "unknown"));
      return;
    }

    toast.success(`${isForward ? "Forward" : "Reply"} sent from ${account.email_address}`);
    setSending(false);
    setComposerMode(null);
    setReplyBody("");
    setForwardTo("");
    setForwardBody("");

    const { data: refreshedMessages } = await supabase.from("emails").select("*").eq("thread_id", threadId).order("sent_at", { ascending: true });
    setMessages((refreshedMessages ?? []) as EmailMsg[]);
    onAfterAction();
  };

  const toggleStar = async () => {
    if (!threadId) return;
    setActing("star");
    const target = !(thread?.has_starred ?? false);
    const { error } = await supabase.from("emails").update({ is_starred: target }).eq("thread_id", threadId);
    setActing(null);
    if (error) {
      toast.error(`Star update failed: ${error.message}`);
      return;
    }
    toast.success(target ? "Thread starred" : "Thread unstarred");
    onAfterAction();
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
          <Button variant="ghost" size="icon" aria-label="Star" onClick={toggleStar} disabled={acting !== null} className="hidden sm:inline-flex">
            <Star className={`size-4 ${(thread?.has_starred ?? false) ? "fill-current" : ""}`} />
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
                void toggleStar();
                setMobileActionsOpen(false);
              }}
              disabled={acting !== null}
            >
              <Star className={`size-4 ${(thread?.has_starred ?? false) ? "fill-current" : ""}`} />
              {(thread?.has_starred ?? false) ? "Unstar" : "Star"}
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
                setReplying(true);
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
        {messages.map(m => (
          <article key={m.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <header className="px-3 md:px-5 py-3 md:py-4 border-b border-border bg-muted/30 flex items-start justify-between gap-2 md:gap-4">
              <div className="flex items-start gap-2 md:gap-3 min-w-0 flex-1">
                <div className="size-8 md:size-9 rounded-full bg-primary/10 grid place-items-center text-sm font-semibold text-primary shrink-0">
                  {(m.sender_name ?? m.sender)[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{m.sender_name ?? m.sender}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.direction === "outbound" ? "from " : ""}{m.sender} → {m.recipient}
                  </p>
                </div>
              </div>
              <span className="text-[11px] md:text-xs text-muted-foreground shrink-0 tabular-nums">
                {format(new Date(m.sent_at), "MMM d, h:mm a")}
              </span>
            </header>
            <div className="px-3 md:px-5 py-3 md:py-4">
              {m.body_html ? (
                <div
                  className="email-html"
                  dangerouslySetInnerHTML={{ __html: renderEmailHtml(m.body_html) }}
                />
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 break-words">{m.body_text || "(empty)"}</p>
              )}
              {(m.attachments ?? []).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/70">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Attachments</p>
                  <div className="flex flex-wrap gap-2">
                    {(m.attachments ?? []).map((att, idx) => {
                      const canOpen = Boolean(att.data_base64);
                      const href = canOpen ? `data:${att.mime_type};base64,${att.data_base64}` : "#";
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
                              toast.error("This attachment is too large to preview inline. Re-sync with smaller message batch or fetch on-demand flow.");
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
          <div className="flex gap-2">
            <Button onClick={() => setComposerMode("reply")} className="gap-2">
              <Reply className="size-4" /> Reply
            </Button>
            <Button variant="outline" className="gap-2" onClick={openForwardComposer}>
              <Forward className="size-4" /> Forward
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/50 border-b border-border flex items-center justify-between gap-3 text-xs">
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
              <button
                onClick={() => {
                  setComposerMode(null);
                  setReplyBody("");
                  setForwardTo("");
                  setForwardBody("");
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <Textarea
              value={composerMode === "forward" ? forwardBody : replyBody}
              onChange={e => composerMode === "forward" ? setForwardBody(e.target.value) : setReplyBody(e.target.value)}
              placeholder={composerMode === "forward" ? "Write your forwarded message…" : "Write your reply…"}
              rows={6}
              className="border-0 rounded-none focus-visible:ring-0 resize-none"
              autoFocus
            />
            <div className="px-4 py-2.5 border-t border-border flex items-center justify-between bg-background">
              <p className="text-[11px] text-muted-foreground">
                {composerMode === "forward"
                  ? "Forwards are sent from the selected inbox address."
                  : "Replies are always sent from the address that received the email."}
              </p>
              <Button
                onClick={handleSend}
                disabled={sending || (composerMode === "forward" ? !forwardTo.trim() || !forwardBody.trim() : !replyBody.trim())}
                className="gap-2"
              >
                <Send className="size-4" /> {sending ? "Sending…" : (composerMode === "forward" ? "Forward" : "Send")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
