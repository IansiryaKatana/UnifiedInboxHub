import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/inbox/Sidebar";
import { AddAccountDialog } from "@/components/inbox/AddAccountDialog";
import { ComposeDialog } from "@/components/inbox/ComposeDialog";
import { Button } from "@/components/ui/button";
import { fetchEmailAccounts, fetchEnrichedThreads } from "@/lib/inbox-data";
import { useForegroundMailboxSync } from "@/hooks/useForegroundMailboxSync";
import { useAppUnreadBadge } from "@/hooks/useAppUnreadBadge";

type Props = {
  children: React.ReactNode;
  /** Highlights the Contacts nav item instead of mailbox folders. */
  contactsActive?: boolean;
};

export function InboxAppLayout({ children, contactsActive = false }: Props) {
  const { user, session, loading: authLoading, isAdmin, hasActiveAccess, accessLoading } = useAuth();
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraftThreadId, setComposeDraftThreadId] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["email-accounts", user?.id],
    queryFn: () => fetchEmailAccounts(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const accountIdsKey = useMemo(() => [...accounts.map((a) => a.id)].sort().join(","), [accounts]);

  const { data: threads = [] } = useQuery({
    queryKey: ["inbox-threads", user?.id, accountIdsKey],
    queryFn: () => fetchEnrichedThreads(),
    enabled: !!user?.id,
    staleTime: 8_000,
    refetchOnWindowFocus: true,
  });

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

  const { scheduleInboundChecks } = useForegroundMailboxSync(
    user?.id,
    accounts,
    accountIdsKey,
    selectedAccountId,
  );

  useAppUnreadBadge(totalUnread);

  if (authLoading || accessLoading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">Sign in to continue.</p>
        <Button asChild>
          <Link to="/auth">Sign in</Link>
        </Button>
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

  return (
    <div className="flex min-h-0 flex-1 bg-background overflow-hidden">
      <Sidebar
        selectedAccountId={selectedAccountId}
        onSelectAccount={setSelectedAccountId}
        onCompose={() => {
          setComposeDraftThreadId(null);
          setComposeOpen(true);
        }}
        activeNav="inbox"
        onChangeNav={() => {}}
        onAddAccount={() => setAddOpen(true)}
        accounts={accounts}
        unreadByAccount={unreadByAccount}
        totalUnread={totalUnread}
        contactsActive={contactsActive}
        onRefresh={async () => {
          await queryClient.invalidateQueries({ queryKey: ["email-accounts", user?.id] });
          await queryClient.invalidateQueries({ queryKey: ["inbox-threads", user?.id] });
        }}
      />

      <div className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden">{children}</div>

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAccountAdded={async () => {
          await queryClient.invalidateQueries({ queryKey: ["email-accounts", user?.id] });
          await queryClient.invalidateQueries({ queryKey: ["inbox-threads", user?.id] });
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
}
