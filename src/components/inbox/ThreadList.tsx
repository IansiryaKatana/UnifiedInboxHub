import { formatDistanceToNowStrict } from "date-fns";
import { AccountBadge } from "./AccountBadge";
import { cn } from "@/lib/utils";
import { Search, Filter, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useMemo, useEffect } from "react";

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
}

interface Props {
  threads: ThreadRow[];
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  loading: boolean;
  onRefresh: () => void;
  filterUnread: boolean;
  onToggleUnread: () => void;
  title: string;
}

export function ThreadList({ threads, selectedThreadId, onSelectThread, loading, onRefresh, filterUnread, onToggleUnread, title }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const titleLabel = title ? title[0].toUpperCase() + title.slice(1) : title;

  const filtered = useMemo(() => {
    let list = threads;
    if (filterUnread) list = list.filter(t => t.unread_count > 0);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(t =>
        (t.subject ?? "").toLowerCase().includes(q) ||
        (t.snippet ?? "").toLowerCase().includes(q) ||
        (t.latest_sender_name ?? "").toLowerCase().includes(q) ||
        (t.latest_sender ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [threads, filterUnread, query]);
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
            <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh">
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
            <Button
              variant={filterUnread ? "default" : "ghost"}
              size="sm"
              onClick={onToggleUnread}
              className="h-8"
            >
              <Filter className="size-3.5 mr-1.5" />
              Unread
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
