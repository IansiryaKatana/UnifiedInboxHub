import { formatDistanceToNowStrict } from "date-fns";
import { AccountBadge } from "./AccountBadge";
import { cn } from "@/lib/utils";
import { Search, Mail, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ThreadRow {
  id: string;
  account_id: string;
  subject: string | null;
  snippet: string | null;
  last_message_at: string;
  unread_count: number;
  message_count: number;
  participants: string[];
  account: { email_address: string; color: string } | null;
  latest_sender_name?: string | null;
  latest_sender?: string | null;
  has_starred?: boolean;
  has_outbound?: boolean;
  folder?: string;
  /** Gmail API label ids (Gmail-linked threads only). */
  gmail_label_ids?: string[];
}

interface Props {
  threads: ThreadRow[];
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  loading: boolean;
  /** True while checking mailboxes for new mail (IMAP/Gmail sync). */
  refreshing?: boolean;
  onRefresh: () => void;
  filterUnread: boolean;
  onToggleUnread: () => void;
  title: string;
  /** Gmail label filter (optional). */
  showGmailLabelFilter?: boolean;
  gmailLabelFilter?: string | null;
  onGmailLabelFilter?: (labelId: string | null) => void;
  gmailLabelOptions?: { id: string; label: string }[];
}

export function ThreadList({
  threads,
  selectedThreadId,
  onSelectThread,
  loading,
  refreshing = false,
  onRefresh,
  filterUnread,
  onToggleUnread,
  title,
  showGmailLabelFilter,
  gmailLabelFilter,
  onGmailLabelFilter,
  gmailLabelOptions = [],
}: Props) {
  const [query, setQuery] = useState("");
  const [searchThreadIds, setSearchThreadIds] = useState<string[] | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const titleLabel = title ? title[0].toUpperCase() + title.slice(1) : title;

  const threadMatchesQuery = (t: ThreadRow, ql: string) =>
    (t.subject ?? "").toLowerCase().includes(ql) ||
    (t.snippet ?? "").toLowerCase().includes(ql) ||
    (t.latest_sender_name ?? "").toLowerCase().includes(ql) ||
    (t.latest_sender ?? "").toLowerCase().includes(ql);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchThreadIds(null);
      return;
    }
    setSearchThreadIds(null);
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        const allow = new Set<string>();
        const emFts = await supabase
          .from("emails")
          .select("thread_id")
          .textSearch("search_tsv", q, { type: "websearch", config: "simple" })
          .limit(500);
        const thFts = await supabase
          .from("email_threads")
          .select("id")
          .textSearch("search_tsv", q, { type: "websearch", config: "simple" })
          .limit(300);
        if (!emFts.error && !thFts.error) {
          for (const r of emFts.data ?? []) if (r.thread_id) allow.add(r.thread_id);
          for (const r of thFts.data ?? []) allow.add(r.id);
          if (allow.size > 0) {
            setSearchThreadIds([...allow]);
            return;
          }
        }
        const esc = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
        const pat = `%${esc}%`;
        const [emSubj, emSnip, emBody, thSubj, thSnip] = await Promise.all([
          supabase.from("emails").select("thread_id").ilike("subject", pat).limit(250),
          supabase.from("emails").select("thread_id").ilike("snippet", pat).limit(250),
          supabase.from("emails").select("thread_id").ilike("body_text", pat).limit(250),
          supabase.from("email_threads").select("id").ilike("subject", pat).limit(200),
          supabase.from("email_threads").select("id").ilike("snippet", pat).limit(200),
        ]);
        if (cancelled) return;
        const errs = [emSubj.error, emSnip.error, emBody.error, thSubj.error, thSnip.error].filter(Boolean);
        if (errs.length > 0) {
          setSearchThreadIds(null);
          return;
        }
        allow.clear();
        for (const r of emSubj.data ?? []) if (r.thread_id) allow.add(r.thread_id);
        for (const r of emSnip.data ?? []) if (r.thread_id) allow.add(r.thread_id);
        for (const r of emBody.data ?? []) if (r.thread_id) allow.add(r.thread_id);
        for (const r of thSubj.data ?? []) allow.add(r.id);
        for (const r of thSnip.data ?? []) allow.add(r.id);
        setSearchThreadIds([...allow]);
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  const filtered = useMemo(() => {
    let list = threads;
    if (filterUnread) list = list.filter(t => t.unread_count > 0);
    const q = query.trim();
    const ql = q.toLowerCase();
    if (q.length >= 2 && searchThreadIds !== null) {
      const allow = new Set(searchThreadIds);
      list = list.filter(t => allow.has(t.id) || threadMatchesQuery(t, ql));
    } else if (q.length > 0) {
      list = list.filter(t => threadMatchesQuery(t, ql));
    }
    return list;
  }, [threads, filterUnread, query, searchThreadIds]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage],
  );

  useEffect(() => {
    setPage(1);
  }, [query, filterUnread, threads.length]);

  return (
    <div className="w-full md:w-full border-r border-border flex flex-col h-full bg-background min-w-0">
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight pl-12 md:pl-0 truncate">{titleLabel}</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Check for new mail"
              title="Check for new mail"
            >
              <RefreshCw className={cn("size-4", (loading || refreshing) && "animate-spin")} />
            </Button>
            <Button
              variant={filterUnread ? "default" : "ghost"}
              size="icon"
              onClick={onToggleUnread}
              className="h-8 w-8 shrink-0"
              aria-label={filterUnread ? "Show all messages" : "Show unread only"}
              title={filterUnread ? "Show all" : "Unread only"}
            >
              <Mail className="size-4" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search mail"
            className="pl-9 h-9 bg-muted/50 border-transparent focus-visible:bg-background"
          />
        </div>
        {showGmailLabelFilter && gmailLabelOptions.length > 0 && onGmailLabelFilter && (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground shrink-0">Gmail label</span>
            <Select
              value={gmailLabelFilter ?? "__all__"}
              onValueChange={(v) => onGmailLabelFilter(v === "__all__" ? null : v)}
            >
              <SelectTrigger className="h-9 w-full sm:w-[200px] bg-muted/50 border-transparent">
                <SelectValue placeholder="All labels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All labels</SelectItem>
                {gmailLabelOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && threads.length === 0 && (
          <div className="p-4 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="space-y-2 animate-pulse">
                <div className="h-3 w-32 bg-muted rounded" />
                <div className="h-4 w-full bg-muted rounded" />
                <div className="h-3 w-3/4 bg-muted rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {query || filterUnread ? "No matching emails" : "Your inbox is empty"}
          </div>
        )}

        {paged.map(t => {
          const isSelected = t.id === selectedThreadId;
          const isUnread = t.unread_count > 0;
          return (
            <button
              key={t.id}
              onClick={() => onSelectThread(t.id)}
              className={cn(
                "w-full text-left px-4 py-3 border-b border-border/50 transition-colors block",
                isSelected ? "bg-primary-soft" : "hover:bg-muted/50",
                isUnread && !isSelected && "bg-background"
              )}
            >
              {t.account && (
                <div className="mb-1.5">
                  <AccountBadge email={t.account.email_address} color={t.account.color} />
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <p className={cn("text-sm truncate", isUnread ? "font-semibold text-foreground" : "text-foreground/90")}>
                  {t.latest_sender_name || t.latest_sender || "Unknown"}
                </p>
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                  {formatDistanceToNowStrict(new Date(t.last_message_at), { addSuffix: false })}
                </span>
              </div>
              <p className={cn("text-sm truncate mb-0.5", isUnread ? "font-medium text-foreground" : "text-foreground/80")}>
                {t.subject || "(no subject)"}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-1">{t.snippet}</p>
            </button>
          );
        })}
      </div>
      {filtered.length > pageSize && (
        <div className="border-t border-border px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <span className="px-1">{currentPage}/{totalPages}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
