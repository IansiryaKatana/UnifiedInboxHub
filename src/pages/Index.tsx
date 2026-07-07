import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/inbox/Sidebar";
import { ThreadList } from "@/components/inbox/ThreadList";
import { ThreadView } from "@/components/inbox/ThreadView";
import { AddAccountDialog } from "@/components/inbox/AddAccountDialog";
import { ComposeDialog } from "@/components/inbox/ComposeDialog";
import { LandingHero } from "@/components/LandingHero";
import { fetchEmailAccounts, fetchEnrichedThreads, type EmailAccountRow } from "@/lib/inbox-data";
import { formatGmailLabelId } from "@/lib/gmail-labels";
import { useForegroundMailboxSync } from "@/hooks/useForegroundMailboxSync";
import { useAppUnreadBadge } from "@/hooks/useAppUnreadBadge";
import { toast } from "sonner";

type Account = EmailAccountRow;

type MailboxView = "inbox" | "drafts" | "starred" | "sent" | "archive" | "trash";

const Index = () => {
  const { session, user, loading: authLoading, isAdmin, hasActiveAccess, accessLoading } = useAuth();
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [filterUnread, setFilterUnread] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraftThreadId, setComposeDraftThreadId] = useState<string | null>(null);
  const [mailboxView, setMailboxView] = useState<MailboxView>("inbox");
  const [gmailLabelFilter, setGmailLabelFilter] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Unified Inbox Hub — Unified email dashboard";
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

  useEffect(() => {
    setGmailLabelFilter(null);
  }, [selectedAccountId, mailboxView]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["email-accounts", user?.id],
    queryFn: () => fetchEmailAccounts(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const accountIdsKey = useMemo(() => [...accounts.map((a) => a.id)].sort().join(","), [accounts]);

  const {
    data: threads = [],
    isLoading: loading,
    refetch: refetchThreads,
  } = useQuery({
    queryKey: ["inbox-threads", user?.id, accountIdsKey],
    queryFn: () => fetchEnrichedThreads(),
    enabled: !!user?.id,
    staleTime: 8_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!user?.id) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["inbox-threads", user.id] });
      }, 400);
    };

    const channel = supabase
      .channel(`inbox-live-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "emails", filter: `user_id=eq.${user.id}` },
        (payload) => {
          // #region agent log
          fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e779de" },
            body: JSON.stringify({
              sessionId: "e779de",
              runId: "post-fix",
              hypothesisId: "H6",
              location: "Index.tsx:realtime",
              message: "emails_change",
              data: { event: payload.eventType, table: payload.table },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          schedule();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "email_threads", filter: `user_id=eq.${user.id}` },
        (payload) => {
          // #region agent log
          fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e779de" },
            body: JSON.stringify({
              sessionId: "e779de",
              runId: "post-fix",
              hypothesisId: "H6",
              location: "Index.tsx:realtime",
              message: "threads_change",
              data: { event: payload.eventType, table: payload.table },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          schedule();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "email_accounts", filter: `user_id=eq.${user.id}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["email-accounts", user.id] });
          schedule();
        },
      )
      .subscribe((status) => {
        // #region agent log
        fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e779de" },
          body: JSON.stringify({
            sessionId: "e779de",
            runId: "post-fix",
            hypothesisId: "H6",
            location: "Index.tsx:realtime",
            message: "channel_status",
            data: { status },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      });

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const invalidateInbox = () => {
    void queryClient.invalidateQueries({ queryKey: ["inbox-threads", user?.id] });
  };

  const hasGmailContext = useMemo(
    () =>
      selectedAccountId
        ? accountsById[selectedAccountId]?.provider_type === "gmail"
        : accounts.some((a) => a.provider_type === "gmail"),
    [selectedAccountId, accounts, accountsById],
  );

  const threadsForLabelOptions = useMemo(() => {
    let list = selectedAccountId ? threads.filter((t) => t.account_id === selectedAccountId) : threads;
    if (mailboxView === "starred") list = list.filter((t) => t.has_starred);
    if (mailboxView === "sent") list = list.filter((t) => t.has_outbound);
    if (mailboxView === "archive") list = list.filter((t) => t.folder === "archive");
    if (mailboxView === "trash") list = list.filter((t) => t.folder === "trash");
    if (mailboxView === "drafts") list = list.filter((t) => t.folder === "drafts");
    if (mailboxView === "inbox") list = list.filter((t) => t.folder === "inbox");
    return list;
  }, [threads, selectedAccountId, mailboxView]);

  const gmailLabelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of threadsForLabelOptions) {
      if (accountsById[t.account_id]?.provider_type !== "gmail") continue;
      for (const id of t.gmail_label_ids ?? []) set.add(id);
    }
    return [...set].sort().map((id) => ({ id, label: formatGmailLabelId(id) }));
  }, [threadsForLabelOptions, accountsById]);

  const showGmailLabelFilter = hasGmailContext && mailboxView !== "drafts" && gmailLabelOptions.length > 0;

  const filteredThreads = useMemo(() => {
    let list = selectedAccountId ? threads.filter((t) => t.account_id === selectedAccountId) : threads;
    if (mailboxView === "starred") list = list.filter((t) => t.has_starred);
    if (mailboxView === "sent") list = list.filter((t) => t.has_outbound);
    if (mailboxView === "archive") list = list.filter((t) => t.folder === "archive");
    if (mailboxView === "trash") list = list.filter((t) => t.folder === "trash");
    if (mailboxView === "drafts") list = list.filter((t) => t.folder === "drafts");
    if (mailboxView === "inbox") list = list.filter((t) => t.folder === "inbox");
    if (gmailLabelFilter) {
      list = list.filter((t) => (t.gmail_label_ids ?? []).includes(gmailLabelFilter));
    }
    return list;
  }, [threads, selectedAccountId, mailboxView, gmailLabelFilter]);

  const unreadByAccount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of threads) {
      map[t.account_id] = (map[t.account_id] ?? 0) + (t.unread_count > 0 ? 1 : 0);
    }
    return map;
  }, [threads]);

  const totalUnread = useMemo(
    () => threads.reduce((sum, t) => sum + (t.unread_count > 0 ? 1 : 0), 0),
    [threads],
  );

  const priorityAccountId = useMemo(() => {
    if (selectedAccountId) return selectedAccountId;
    if (selectedThreadId) {
      return threads.find((t) => t.id === selectedThreadId)?.account_id ?? null;
    }
    // "All inboxes" with one mailbox still needs fast polling — no explicit sidebar click required.
    if (accounts.length === 1) return accounts[0].id;
    return null;
  }, [selectedAccountId, selectedThreadId, threads, accounts]);

  const { runSync, syncing, scheduleInboundChecks } = useForegroundMailboxSync(
    user?.id,
    accounts,
    accountIdsKey,
    priorityAccountId,
  );
  const prevAccountCountRef = useRef(0);

  const refreshInbox = useCallback(async () => {
    const syncAccountId =
      selectedAccountId ?? (accounts.length === 1 ? accounts[0].id : null);
    // #region agent log
    fetch("http://127.0.0.1:7618/ingest/5e429cc6-9e4d-4191-8a07-7d3d98cdf51b", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e779de" },
      body: JSON.stringify({
        sessionId: "e779de",
        runId: "post-fix",
        hypothesisId: "H4",
        location: "Index.tsx:refreshInbox",
        message: "user_manual_refresh",
        data: {
          syncAccountId,
          accountCount: accounts.length,
          selectedAccountId,
          providers: accounts.map((a) => a.provider_type),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const { imported } = await runSync({
      force: true,
      userInitiated: true,
      accountId: syncAccountId,
    });
    await refetchThreads();
    if (imported > 0) {
      toast.success(`Imported ${imported} new message${imported === 1 ? "" : "s"}`);
    }
  }, [runSync, selectedAccountId, accounts, refetchThreads]);

  useEffect(() => {
    if (!user?.id || accounts.length === 0) return;
    if (accounts.length > prevAccountCountRef.current) {
      const id = accounts.length === 1 ? accounts[0].id : undefined;
      void runSync(
        id ? { force: true, accountId: id } : { force: true },
      );
    }
    prevAccountCountRef.current = accounts.length;
  }, [accounts.length, user?.id, runSync, accounts]);

  useAppUnreadBadge(totalUnread);

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
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
            : mailboxView === "drafts"
              ? "Drafts"
              : "All inboxes";

  if (authLoading || accessLoading) return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
        <LandingHero />
      </div>
    );
  }
  if (!hasActiveAccess && !isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-lg font-semibold">Access expired</h1>
          <p className="text-sm text-muted-foreground">
            Your access has expired. Contact your administrator to restore access.
          </p>
        </div>
      </div>
    );
  }

  const mobileView: "sidebar" | "list" | "thread" = selectedThreadId ? "thread" : "list";

  return (
    <div className="flex min-h-0 flex-1 bg-background overflow-hidden">
      <Sidebar
        selectedAccountId={selectedAccountId}
        onSelectAccount={(id) => {
          setSelectedAccountId(id);
          setSelectedThreadId(null);
        }}
        onCompose={() => {
          setComposeDraftThreadId(null);
          setComposeOpen(true);
        }}
        activeNav={mailboxView}
        onChangeNav={setMailboxView}
        onAddAccount={() => setAddOpen(true)}
        accounts={accounts}
        unreadByAccount={unreadByAccount}
        totalUnread={totalUnread}
        onRefresh={async () => {
          await queryClient.invalidateQueries({ queryKey: ["email-accounts", user?.id] });
          await queryClient.invalidateQueries({ queryKey: ["inbox-threads", user?.id] });
        }}
      />

      <div
        className={
          "flex-1 md:flex-initial md:w-[380px] lg:w-[420px] md:shrink-0 min-w-0 " +
          (mobileView === "thread" ? "hidden md:flex" : "flex")
        }
      >
        <ThreadList
          threads={filteredThreads}
          selectedThreadId={selectedThreadId}
          onSelectThread={(id) => {
            const row = filteredThreads.find((x) => x.id === id);
            if (row?.folder === "drafts") {
              void (async () => {
                const { data: t } = await supabase.from("email_threads").select("draft_content").eq("id", id).single();
                const c = t?.draft_content as Record<string, unknown> | null;
                const kind = c?.kind as string | undefined;
                const ctx = c?.context_thread_id;
                if ((kind === "reply" || kind === "forward") && typeof ctx === "string") {
                  try {
                    sessionStorage.setItem("inbox-reply-draft", JSON.stringify({ ...c, threadDraftId: id }));
                  } catch {
                    /* ignore */
                  }
                  setSelectedThreadId(ctx);
                  setMailboxView("inbox");
                  return;
                }
                setComposeDraftThreadId(id);
                setComposeOpen(true);
              })();
              return;
            }
            setSelectedThreadId(id);
          }}
          loading={loading}
          refreshing={syncing}
          onRefresh={() => void refreshInbox()}
          filterUnread={filterUnread}
          onToggleUnread={() => setFilterUnread((v) => !v)}
          title={title}
          showGmailLabelFilter={showGmailLabelFilter}
          gmailLabelFilter={gmailLabelFilter}
          onGmailLabelFilter={setGmailLabelFilter}
          gmailLabelOptions={gmailLabelOptions}
        />
      </div>

      <div className={"flex-1 min-w-0 " + (mobileView === "thread" ? "flex" : "hidden md:flex")}>
        <ThreadView
          threadId={selectedThreadId}
          thread={selectedThread ?? null}
          account={selectedAccount as Account | null}
          onAfterAction={invalidateInbox}
          onAfterSend={scheduleInboundChecks}
          onBack={() => setSelectedThreadId(null)}
        />
      </div>

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAccountAdded={async () => {
          await queryClient.invalidateQueries({ queryKey: ["email-accounts", user?.id] });
          await queryClient.refetchQueries({ queryKey: ["inbox-threads", user?.id] });
        }}
      />
      <ComposeDialog
        open={composeOpen}
        onOpenChange={(open) => {
          setComposeOpen(open);
          if (!open) setComposeDraftThreadId(null);
        }}
        accounts={accounts}
        draftThreadId={composeDraftThreadId}
        onDraftCreated={(id) => setComposeDraftThreadId(id)}
        onDraftSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ["inbox-threads", user?.id] });
        }}
        onSent={async (accountId) => {
          setComposeDraftThreadId(null);
          await queryClient.invalidateQueries({ queryKey: ["inbox-threads", user?.id] });
          if (accountId) scheduleInboundChecks(accountId);
        }}
      />
    </div>
  );
};

export default Index;
