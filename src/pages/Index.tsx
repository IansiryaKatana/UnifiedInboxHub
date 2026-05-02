import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/inbox/Sidebar";
import { ThreadList, ThreadRow } from "@/components/inbox/ThreadList";
import { ThreadView } from "@/components/inbox/ThreadView";
import { AddAccountDialog } from "@/components/inbox/AddAccountDialog";
import { ComposeDialog } from "@/components/inbox/ComposeDialog";
import { toast } from "sonner";
import { LandingHero } from "@/components/LandingHero";

interface Account {
  id: string;
  email_address: string;
  display_name: string | null;
  color: string;
  sync_status: string;
  provider_type: string;
}

type MailboxView = "inbox" | "starred" | "sent" | "archive" | "trash";

const Index = () => {
  const { session, user, loading: authLoading } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterUnread, setFilterUnread] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [mailboxView, setMailboxView] = useState<MailboxView>("inbox");

  useEffect(() => {
    document.title = "Inboxly — Unified email dashboard";
  }, []);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const tid = params.get("thread");
    if (tid) {
      setSelectedThreadId(tid);
      setMailboxView("inbox");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [user?.id]);

  const accountsById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);

  const loadAccounts = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    setAccounts((data ?? []) as Account[]);
  };

  const loadThreads = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user) return;
    if (!opts?.silent) setLoading(true);
    const pageSize = 1000;
    let from = 0;
    let keepLoading = true;
    const allThreads: any[] = [];
    let error: { message: string } | null = null;

    while (keepLoading) {
      const { data: batch, error: batchError } = await supabase
        .from("email_threads")
        .select("*")
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (batchError) {
        error = batchError;
        break;
      }

      allThreads.push(...(batch ?? []));
      if (!batch || batch.length < pageSize) {
        keepLoading = false;
      } else {
        from += pageSize;
      }
    }

    if (error) {
      toast.error(error.message);
      if (!opts?.silent) setLoading(false);
      return;
    }

    // Get latest sender for each thread
    const threadIds = allThreads.map(t => t.id);
    const { data: latestEmails } = await supabase
      .from("emails")
      .select("thread_id, sender, sender_name, sent_at, direction, is_starred")
      .in("thread_id", threadIds.length ? threadIds : ["00000000-0000-0000-0000-000000000000"])
      .order("sent_at", { ascending: false });

    const latestByThread: Record<string, { sender: string; sender_name: string | null }> = {};
    const starredThreadIds = new Set<string>();
    const sentThreadIds = new Set<string>();
    for (const e of latestEmails ?? []) {
      if (e.direction === "inbound" && !latestByThread[e.thread_id!]) {
        latestByThread[e.thread_id!] = { sender: e.sender, sender_name: e.sender_name };
      }
      if (e.is_starred) starredThreadIds.add(e.thread_id!);
      if (e.direction === "outbound") sentThreadIds.add(e.thread_id!);
    }

    const enriched: ThreadRow[] = allThreads.map(t => ({
      ...t,
      account: accountsById[t.account_id]
        ? { email_address: accountsById[t.account_id].email_address, color: accountsById[t.account_id].color }
        : null,
      latest_sender: latestByThread[t.id]?.sender ?? null,
      latest_sender_name: latestByThread[t.id]?.sender_name ?? null,
      has_starred: starredThreadIds.has(t.id),
      has_outbound: sentThreadIds.has(t.id),
    }));

    setThreads(enriched);
    if (!opts?.silent) setLoading(false);
  }, [user, accountsById]);

  const loadThreadsRef = useRef(loadThreads);
  loadThreadsRef.current = loadThreads;

  useEffect(() => {
    if (!user?.id) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        loadThreadsRef.current({ silent: true });
      }, 400);
    };

    const channel = supabase
      .channel(`inbox-live-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "emails", filter: `user_id=eq.${user.id}` },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "email_threads", filter: `user_id=eq.${user.id}` },
        schedule,
      )
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Initial load from live database
  useEffect(() => {
    if (!user) return;
    (async () => {
      await loadAccounts();
    })();
  }, [user?.id]);

  // Reload threads when accounts change
  useEffect(() => {
    if (accounts.length === 0 && user) {
      loadThreads();
    } else if (accounts.length > 0) {
      loadThreads();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const filteredThreads = useMemo(() => {
    let list = selectedAccountId ? threads.filter(t => t.account_id === selectedAccountId) : threads;
    if (mailboxView === "starred") list = list.filter((t) => t.has_starred);
    if (mailboxView === "sent") list = list.filter((t) => t.has_outbound);
    if (mailboxView === "archive") list = list.filter((t) => t.folder === "archive");
    if (mailboxView === "trash") list = list.filter((t) => t.folder === "trash");
    if (mailboxView === "inbox") list = list.filter((t) => t.folder === "inbox");
    return list;
  }, [threads, selectedAccountId, mailboxView]);

  const unreadByAccount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of threads) {
      map[t.account_id] = (map[t.account_id] ?? 0) + (t.unread_count > 0 ? 1 : 0);
    }
    return map;
  }, [threads]);

  const totalUnread = useMemo(
    () => threads.reduce((sum, t) => sum + (t.unread_count > 0 ? 1 : 0), 0),
    [threads]
  );

  const selectedThread = threads.find(t => t.id === selectedThreadId);
  const selectedAccount = selectedThread ? accountsById[selectedThread.account_id] ?? null : null;

  const title = selectedAccountId
    ? accountsById[selectedAccountId]?.email_address ?? "Inbox"
    : mailboxView === "starred"
      ? "Starred"
      : mailboxView === "sent"
        ? "Sent"
        : mailboxView === "archive"
          ? "Archive"
          : mailboxView === "trash"
            ? "Trash"
            : "All inboxes";

  if (authLoading) return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (!session) return <LandingHero />;

  // Mobile pane navigation: sidebar -> list -> thread
  const mobileView: "sidebar" | "list" | "thread" =
    selectedThreadId ? "thread" : "list";

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden">
      {/* Sidebar: drawer on mobile, fixed on md+ */}
      <Sidebar
        selectedAccountId={selectedAccountId}
        onSelectAccount={(id) => { setSelectedAccountId(id); setSelectedThreadId(null); }}
        onCompose={() => setComposeOpen(true)}
        activeNav={mailboxView}
        onChangeNav={setMailboxView}
        onAddAccount={() => setAddOpen(true)}
        accounts={accounts}
        unreadByAccount={unreadByAccount}
        totalUnread={totalUnread}
        onRefresh={async () => { await loadAccounts(); await loadThreads(); }}
      />

      {/* Thread list: hidden on mobile when a thread is open */}
      <div
        className={
          "flex-1 md:flex-initial md:w-[380px] lg:w-[420px] md:shrink-0 min-w-0 " +
          (mobileView === "thread" ? "hidden md:flex" : "flex")
        }
      >
        <ThreadList
          threads={filteredThreads}
          selectedThreadId={selectedThreadId}
          onSelectThread={setSelectedThreadId}
          loading={loading}
          onRefresh={loadThreads}
          filterUnread={filterUnread}
          onToggleUnread={() => setFilterUnread(v => !v)}
          title={title}
        />
      </div>

      {/* Thread view: full-width on mobile when open, else right pane on md+ */}
      <div
        className={
          "flex-1 min-w-0 " +
          (mobileView === "thread" ? "flex" : "hidden md:flex")
        }
      >
        <ThreadView
          threadId={selectedThreadId}
          thread={selectedThread ?? null}
          account={selectedAccount as any}
          onAfterAction={loadThreads}
          onBack={() => setSelectedThreadId(null)}
        />
      </div>

      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} onAccountAdded={async () => { await loadAccounts(); await loadThreads(); }} />
      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        accounts={accounts}
        onSent={async () => {
          await loadThreads();
        }}
      />
    </div>
  );
};

export default Index;
