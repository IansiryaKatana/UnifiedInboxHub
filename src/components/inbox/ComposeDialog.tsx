import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ComposeRichEditor } from "./ComposeRichEditor.tsx";
import { useIsMobile } from "@/hooks/use-mobile";

interface Account {
  id: string;
  email_address: string;
  display_name: string | null;
  provider_type: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  onSent: () => Promise<void> | void;
}

type RecipientFieldKey = "to" | "cc" | "bcc";

export function ComposeDialog({ open, onOpenChange, accounts, onSent }: Props) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [toRecipients, setToRecipients] = useState<string[]>([]);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [bccRecipients, setBccRecipients] = useState<string[]>([]);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [activeRecipientField, setActiveRecipientField] = useState<RecipientFieldKey>("to");
  const [recipientSuggestions, setRecipientSuggestions] = useState<string[]>([]);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showRecipientSuggestions, setShowRecipientSuggestions] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyEditorKey, setBodyEditorKey] = useState(0);
  const [attachments, setAttachments] = useState<Array<{
    filename: string;
    mime_type: string;
    size: number;
    data_base64: string;
  }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const suggestionsReqRef = useRef(0);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  const resetForm = () => {
    setToRecipients([]);
    setCcRecipients([]);
    setBccRecipients([]);
    setToInput("");
    setCcInput("");
    setBccInput("");
    setActiveRecipientField("to");
    setRecipientSuggestions([]);
    setActiveSuggestionIdx(-1);
    setShowRecipientSuggestions(false);
    setSubject("");
    setBodyHtml("");
    setBodyEditorKey((k) => k + 1);
    setAttachments([]);
    setAccountId(accounts[0]?.id ?? "");
  };

  const htmlToText = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").trim();
  };

  const normalizeEmail = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const match = trimmed.match(/<([^>]+)>/);
    const email = (match?.[1] ?? trimmed).trim().toLowerCase();
    return email;
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = (email: string) => emailRegex.test(email);
  const parseEmailTokens = (raw: string) =>
    raw
      .split(/[;,]/g)
      .map((part) => normalizeEmail(part))
      .filter(Boolean);

  const getInputByField = (field: RecipientFieldKey) => {
    if (field === "to") return toInput;
    if (field === "cc") return ccInput;
    return bccInput;
  };

  const setInputByField = (field: RecipientFieldKey, value: string) => {
    if (field === "to") setToInput(value);
    else if (field === "cc") setCcInput(value);
    else setBccInput(value);
  };

  const getRecipientsByField = (field: RecipientFieldKey) => {
    if (field === "to") return toRecipients;
    if (field === "cc") return ccRecipients;
    return bccRecipients;
  };

  const setRecipientsByField = (field: RecipientFieldKey, values: string[]) => {
    if (field === "to") setToRecipients(values);
    else if (field === "cc") setCcRecipients(values);
    else setBccRecipients(values);
  };

  const addRecipients = (field: RecipientFieldKey, raw: string) => {
    const parsed = parseEmailTokens(raw);
    if (!parsed.length) return [];
    const invalid = parsed.filter((email) => !isValidEmail(email));
    if (invalid.length > 0) return invalid;

    const existing = getRecipientsByField(field);
    const merged = Array.from(new Set([...existing, ...parsed]));
    setRecipientsByField(field, merged);
    return [];
  };

  const commitDraftField = (field: RecipientFieldKey) => {
    const current = getInputByField(field);
    const invalid = addRecipients(field, current);
    if (invalid.length > 0) {
      toast.error(`Invalid email${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`);
      return false;
    }
    setInputByField(field, "");
    return true;
  };

  useEffect(() => {
    if (!open || !accountId) {
      setRecipientSuggestions([]);
      setActiveSuggestionIdx(-1);
      setShowRecipientSuggestions(false);
      return;
    }

    const activeInput =
      activeRecipientField === "to"
        ? toInput
        : activeRecipientField === "cc"
          ? ccInput
          : bccInput;
    const search = activeInput.trim().toLowerCase();

    const reqId = ++suggestionsReqRef.current;
    setLoadingSuggestions(true);
    const timeout = window.setTimeout(async () => {
      let query = supabase
        .from("emails")
        .select("recipient, sent_at")
        .eq("account_id", accountId)
        .eq("direction", "outbound")
        .order("sent_at", { ascending: false });

      if (search) {
        query = query.ilike("recipient", `%${search}%`).limit(200);
      } else {
        query = query.limit(80);
      }

      const { data, error } = await query;

      if (reqId !== suggestionsReqRef.current) return;

      if (error) {
        setLoadingSuggestions(false);
        setRecipientSuggestions([]);
        setShowRecipientSuggestions(false);
        return;
      }

      const ranked = new Map<string, { count: number; lastSentAt: string }>();
      for (const row of data ?? []) {
        const rawRecipients = String(row.recipient ?? "")
          .split(/[;,]/g)
          .map((part) => normalizeEmail(part))
          .filter(Boolean);

        for (const email of rawRecipients) {
          if (search && !email.includes(search)) continue;
          const existing = ranked.get(email);
          if (!existing) {
            ranked.set(email, { count: 1, lastSentAt: row.sent_at });
          } else {
            existing.count += 1;
            if (row.sent_at > existing.lastSentAt) existing.lastSentAt = row.sent_at;
          }
        }
      }

      const suggestions = [...ranked.entries()]
        .sort((a, b) => {
          const aStarts = search && a[0].startsWith(search) ? 1 : 0;
          const bStarts = search && b[0].startsWith(search) ? 1 : 0;
          if (aStarts !== bStarts) return bStarts - aStarts;
          if (a[1].count !== b[1].count) return b[1].count - a[1].count;
          return b[1].lastSentAt.localeCompare(a[1].lastSentAt);
        })
        .slice(0, 8)
        .map(([email]) => email);

      setLoadingSuggestions(false);
      setRecipientSuggestions(suggestions);
      setActiveSuggestionIdx(-1);
      setShowRecipientSuggestions(true);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      setLoadingSuggestions(false);
    };
  }, [open, accountId, toInput, ccInput, bccInput, activeRecipientField]);

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Array<{
      filename: string;
      mime_type: string;
      size: number;
      data_base64: string;
    }> = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 10MB.`);
        continue;
      }
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          const idx = result.indexOf(",");
          resolve(idx >= 0 ? result.slice(idx + 1) : "");
        };
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
      });
      next.push({
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        size: file.size,
        data_base64: b64,
      });
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 10));
  };

  const handleOpenChange = (next: boolean) => {
    if (next && !accountId && accounts[0]?.id) setAccountId(accounts[0].id);
    if (!next) resetForm();
    onOpenChange(next);
  };

  const send = async () => {
    if (!user) return;
    const toReady = commitDraftField("to");
    const ccReady = commitDraftField("cc");
    const bccReady = commitDraftField("bcc");
    if (!toReady || !ccReady || !bccReady) return;
    if (!selectedAccount) {
      toast.error("Select a sender account.");
      return;
    }
    if (!toRecipients.length) {
      toast.error("At least one To recipient is required.");
      return;
    }
    const bodyText = htmlToText(bodyHtml);
    if (!bodyText) {
      toast.error("Message is required.");
      return;
    }

    setSending(true);
    try {
      const sentAt = new Date().toISOString();
      const allRecipients = Array.from(new Set([...toRecipients, ...ccRecipients, ...bccRecipients]));
      const { data: thread, error: threadError } = await supabase
        .from("email_threads")
        .insert({
          user_id: user.id,
          account_id: selectedAccount.id,
          subject: subject.trim() || "(no subject)",
          participants: [selectedAccount.email_address, ...allRecipients],
          last_message_at: sentAt,
          message_count: 1,
          unread_count: 0,
          snippet: bodyText.slice(0, 140),
        })
        .select("id")
        .single();
      if (threadError || !thread?.id) {
        throw new Error(threadError?.message ?? "Failed to create thread");
      }

      const fnName = selectedAccount.provider_type === "gmail" ? "gmail-send" : "smtp-send";
      const { data, error } = await supabase.functions.invoke(fnName, {
        body: {
          account_id: selectedAccount.id,
          thread_id: thread.id,
          to: toRecipients.join(", "),
          cc: ccRecipients,
          bcc: bccRecipients,
          subject: subject.trim() || "(no subject)",
          body_text: bodyText,
          html_body: bodyHtml,
          attachments,
        },
      });
      if (error || !data?.ok) {
        throw new Error(error?.message ?? data?.error ?? "Failed to send");
      }

      toast.success(`Sent from ${selectedAccount.email_address}`);
      await onSent();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "h-[94vh] rounded-t-2xl p-0" : "h-screen w-[40vw] min-w-[620px] max-w-none p-0"}
      >
        <SheetHeader className="px-4 md:px-6 py-4 border-b border-border">
          <SheetTitle>Compose message</SheetTitle>
          <SheetDescription>Send email with rich formatting and attachments.</SheetDescription>
        </SheetHeader>

        <div className="h-[calc(94vh-150px)] overflow-y-auto px-4 md:px-6 py-4 space-y-4">
          <div className="space-y-2">
            <Label>From</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder={accounts.length ? "Select account" : "No accounts connected"} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.email_address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <div className="relative">
              <div className="min-h-10 rounded-md border border-input bg-background px-2 py-1 flex flex-wrap items-center gap-1">
                {toRecipients.map((email) => (
                  <span key={`to-${email}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                    {email}
                    <button
                      type="button"
                      onClick={() => setToRecipients((prev) => prev.filter((value) => value !== email))}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${email}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={toInput}
                  onChange={(e) => {
                    setToInput(e.target.value);
                    setActiveSuggestionIdx(-1);
                  }}
                  onFocus={() => {
                    setActiveRecipientField("to");
                    setShowRecipientSuggestions(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setShowRecipientSuggestions(false), 120);
                    void commitDraftField("to");
                  }}
                  onKeyDown={(e) => {
                    if (showRecipientSuggestions && recipientSuggestions.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActiveSuggestionIdx((prev) => (prev + 1) % recipientSuggestions.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActiveSuggestionIdx((prev) => (prev <= 0 ? recipientSuggestions.length - 1 : prev - 1));
                        return;
                      }
                      if (e.key === "Enter" && activeSuggestionIdx >= 0) {
                        e.preventDefault();
                        const selected = recipientSuggestions[activeSuggestionIdx];
                        if (selected) {
                          addRecipients("to", selected);
                          setToInput("");
                          setShowRecipientSuggestions(false);
                          setActiveSuggestionIdx(-1);
                        }
                        return;
                      }
                    }
                    if (e.key === "Enter" || e.key === "," || e.key === ";") {
                      e.preventDefault();
                      void commitDraftField("to");
                    }
                    if (e.key === "Backspace" && !toInput && toRecipients.length > 0) {
                      setToRecipients((prev) => prev.slice(0, -1));
                    }
                    if (e.key === "Escape") {
                      setShowRecipientSuggestions(false);
                      setActiveSuggestionIdx(-1);
                    }
                  }}
                  placeholder={toRecipients.length ? "" : "name@example.com"}
                  className="h-8 flex-1 min-w-[180px] bg-transparent px-1 text-sm outline-none"
                />
              </div>
              {showRecipientSuggestions && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
                  {recipientSuggestions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {loadingSuggestions ? "Loading recipients..." : "No suggestions found"}
                    </p>
                  ) : (
                    <div className="max-h-56 overflow-y-auto py-1">
                      {recipientSuggestions.map((email, idx) => (
                        <button
                          key={email}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addRecipients(activeRecipientField, email);
                            setInputByField(activeRecipientField, "");
                            setShowRecipientSuggestions(false);
                            setActiveSuggestionIdx(-1);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm ${activeSuggestionIdx === idx ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"}`}
                        >
                          {email}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Cc</Label>
            <div className="min-h-10 rounded-md border border-input bg-background px-2 py-1 flex flex-wrap items-center gap-1">
              {ccRecipients.map((email) => (
                <span key={`cc-${email}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                  {email}
                  <button type="button" onClick={() => setCcRecipients((prev) => prev.filter((value) => value !== email))} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${email}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={ccInput}
                onChange={(e) => {
                  setCcInput(e.target.value);
                  setActiveSuggestionIdx(-1);
                }}
                onFocus={() => {
                  setActiveRecipientField("cc");
                  setShowRecipientSuggestions(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => setShowRecipientSuggestions(false), 120);
                  void commitDraftField("cc");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === ";") {
                    e.preventDefault();
                    void commitDraftField("cc");
                  }
                }}
                placeholder={ccRecipients.length ? "" : "Add Cc"}
                className="h-8 flex-1 min-w-[180px] bg-transparent px-1 text-sm outline-none"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Bcc</Label>
            <div className="min-h-10 rounded-md border border-input bg-background px-2 py-1 flex flex-wrap items-center gap-1">
              {bccRecipients.map((email) => (
                <span key={`bcc-${email}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                  {email}
                  <button type="button" onClick={() => setBccRecipients((prev) => prev.filter((value) => value !== email))} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${email}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={bccInput}
                onChange={(e) => {
                  setBccInput(e.target.value);
                  setActiveSuggestionIdx(-1);
                }}
                onFocus={() => {
                  setActiveRecipientField("bcc");
                  setShowRecipientSuggestions(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => setShowRecipientSuggestions(false), 120);
                  void commitDraftField("bcc");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === ";") {
                    e.preventDefault();
                    void commitDraftField("bcc");
                  }
                }}
                placeholder={bccRecipients.length ? "" : "Add Bcc"}
                className="h-8 flex-1 min-w-[180px] bg-transparent px-1 text-sm outline-none"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="(no subject)" className="h-10" />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <ComposeRichEditor
              key={bodyEditorKey}
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Write your message..."
              disabled={sending}
              className="compose-editor"
            />
          </div>
          <div className="space-y-2">
            <Label>Attachments</Label>
            <div
              className={`rounded-lg border border-dashed p-3 md:p-4 transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void pickFiles(e.dataTransfer.files);
              }}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs md:text-sm text-muted-foreground">
                  Drag and drop files here, or choose files manually.
                </p>
                <label className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm cursor-pointer hover:bg-muted/40 w-fit">
                  <Paperclip className="size-4" />
                  Attach files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void pickFiles(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((file, idx) => (
                  <span key={`${file.filename}-${idx}`} className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs bg-muted/20">
                    <span className="max-w-[180px] truncate">{file.filename}</span>
                    <span className="text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
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
        </div>

        <div className="border-t border-border px-4 md:px-6 py-3 flex items-center justify-end gap-2 bg-background">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || accounts.length === 0 || !accountId}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sending ? "Sending..." : "Send"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
