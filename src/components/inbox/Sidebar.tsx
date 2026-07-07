import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Inbox, Send, Star, Archive, Trash2, FileEdit, Plus, LogOut, Menu, Settings, Bell, AlertCircle, BookUser, ChevronDown } from "lucide-react";
import { InstallAppSidebar } from "@/components/InstallAppBanner";
import { useOutboxCount } from "@/hooks/useOutboxCount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { AccountSettingsDialog } from "./AccountSettingsDialog";
import { deleteEmailAccount } from "@/lib/delete-email-account";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Account {
  id: string;
  email_address: string;
  display_name: string | null;
  color: string;
  sync_status: string;
  provider_type: string;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_username?: string | null;
  imap_use_tls?: boolean | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_username?: string | null;
  smtp_use_tls?: boolean | null;
  last_sync_error?: string | null;
}

interface Props {
  selectedAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
  onCompose: () => void;
  activeNav: "inbox" | "drafts" | "starred" | "sent" | "archive" | "trash";
  onChangeNav: (nav: "inbox" | "drafts" | "starred" | "sent" | "archive" | "trash") => void;
  onAddAccount: () => void;
  accounts: Account[];
  unreadByAccount: Record<string, number>;
  totalUnread: number;
  /** When true, the Contacts link is highlighted (e.g. on /contacts). */
  contactsActive?: boolean;
}

const navItems = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "drafts", label: "Drafts", icon: FileEdit },
  { id: "starred", label: "Starred", icon: Star },
  { id: "sent", label: "Sent", icon: Send },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash2 },
];

export function Sidebar({ selectedAccountId, onSelectAccount, onCompose, activeNav, onChangeNav, onAddAccount, accounts, unreadByAccount, totalUnread, contactsActive = false, onRefresh }: Props & { onRefresh: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const push = usePushNotifications(user?.id);
  const outboxCount = useOutboxCount();
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(true);
  const displayLabel = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

  useEffect(() => {
    if (!user?.id) {
      setProfileDisplayName(null);
      return;
    }
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const n = data?.display_name?.trim();
        setProfileDisplayName(n || null);
      });
  }, [user?.id]);

  const meta = user?.user_metadata as { display_name?: unknown; full_name?: unknown } | undefined;
  const metaDisplay =
    typeof meta?.display_name === "string" ? meta.display_name.trim() : typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  const primaryName = (profileDisplayName?.trim() || metaDisplay || "").trim();
  const userEmail = user?.email?.trim() ?? "";
  const sidebarTitle = primaryName || userEmail || "Account";
  const showEmailUnderName = Boolean(primaryName && userEmail && primaryName !== userEmail);
  const avatarInitial = (primaryName[0] ?? userEmail[0] ?? "U").toUpperCase();

  const deleteAccount = async (acc: Account) => {
    await deleteEmailAccount(supabase, acc.id);
    if (selectedAccountId === acc.id) onSelectAccount(null);
    onRefresh();
  };

  const inner = (
    <div className="w-full md:w-64 bg-sidebar md:border-r border-sidebar-border flex flex-col h-full">
      <div className="p-4 flex items-center gap-2">
        <img
          src="/pwa-192.png"
          alt=""
          width={32}
          height={32}
          className="size-8 rounded-lg object-cover shrink-0"
          decoding="async"
          aria-hidden
        />
        <span className="font-semibold tracking-tight">Unified Inbox Hub</span>
      </div>

      <div className="px-3 pb-3 space-y-2">
        <Button onClick={onCompose} className="w-full justify-start gap-2 shadow-sm" size="lg">
          <Plus className="size-4" /> Compose
        </Button>
        <Button
          variant={contactsActive ? "secondary" : "outline"}
          className={cn(
            "w-full justify-start gap-2",
            contactsActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
          )}
          size="sm"
          asChild
        >
          <Link to="/contacts">
            <BookUser className="size-4" /> Contacts
          </Link>
        </Button>
        {outboxCount > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 px-1 flex items-center gap-1.5">
            <Badge variant="secondary" className="font-normal text-[10px] px-1.5 py-0">
              {outboxCount} queued
            </Badge>
            <span className="text-muted-foreground">Sends when online</span>
          </p>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2 space-y-0.5">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = !contactsActive && activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                if (contactsActive) {
                  navigate("/");
                  return;
                }
                onChangeNav(item.id as "inbox" | "drafts" | "starred" | "sent" | "archive" | "trash");
              }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <span className="flex items-center gap-3">
                <Icon className="size-4" />
                {item.label}
              </span>
              {item.id === "inbox" && totalUnread > 0 && (
                <span className="text-xs font-semibold text-primary">{totalUnread}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto shrink-0 flex flex-col">
        <InstallAppSidebar />

        <div className="border-t border-sidebar-border">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-1 px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accounts</h3>
              <button
                type="button"
                onClick={onAddAccount}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Add account"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <div
              className={cn(
                "w-full flex items-center rounded-md text-sm transition-colors",
                selectedAccountId === null
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground"
              )}
            >
              <button
                type="button"
                onClick={() => setAccountsOpen((v) => !v)}
                className="shrink-0 p-1.5 pl-2 text-muted-foreground hover:text-foreground"
                aria-expanded={accountsOpen}
                aria-label={accountsOpen ? "Collapse accounts" : "Expand accounts"}
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform", !accountsOpen && "-rotate-90")}
                  aria-hidden
                />
              </button>
              <button
                type="button"
                onClick={() => onSelectAccount(null)}
                className={cn(
                  "flex flex-1 items-center justify-between py-1.5 pr-2 min-w-0 text-left",
                  selectedAccountId !== null && "hover:bg-sidebar-accent/50 rounded-r-md"
                )}
              >
                <span>All inboxes</span>
                {totalUnread > 0 && <span className="text-xs text-muted-foreground">{totalUnread}</span>}
              </button>
            </div>
            {accountsOpen && (
              <div className="space-y-0.5 mt-0.5">
                {accounts.map(acc => (
                  <div
                    key={acc.id}
                    className={cn(
                      "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors group",
                      selectedAccountId === acc.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectAccount(acc.id)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      title={acc.sync_status === "error" && acc.last_sync_error ? acc.last_sync_error : undefined}
                    >
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                      <span className="truncate">{displayLabel(acc.email_address)}</span>
                      {acc.sync_status === "error" && (
                        <AlertCircle className="size-3.5 shrink-0 text-amber-600" aria-hidden />
                      )}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {(unreadByAccount[acc.id] ?? 0) > 0 && (
                        <span className="text-xs text-muted-foreground">{unreadByAccount[acc.id]}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditAccount(acc)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                        aria-label="Edit account"
                        title="Edit account"
                      >
                        <Settings className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {accounts.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-2">No accounts yet</p>
                )}
              </div>
            )}
          </div>
        </div>

      {push.supported && (
        <div
          className={cn(
            "px-3 py-2.5 border-t border-sidebar-border transition-colors",
            push.enabled && "bg-primary/10",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="push-notify" className="flex items-center gap-2 min-w-0 cursor-pointer">
              <Bell
                className={cn(
                  "size-3.5 shrink-0 transition-colors",
                  push.enabled ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden
                fill={push.enabled ? "currentColor" : "none"}
              />
              <span className="text-xs font-medium leading-tight">New mail alerts</span>
              <Badge
                variant={push.enabled ? "default" : "secondary"}
                className={cn(
                  "h-4 px-1.5 text-[10px] font-semibold uppercase tracking-wide",
                  !push.enabled && "bg-muted text-muted-foreground",
                )}
              >
                {push.busy ? "…" : push.enabled ? "On" : "Off"}
              </Badge>
            </Label>
            <Switch
              id="push-notify"
              checked={push.enabled}
              disabled={push.busy}
              aria-label={push.enabled ? "Turn off new mail alerts" : "Turn on new mail alerts"}
              className={cn(
                "data-[state=checked]:bg-primary",
                !push.enabled && "data-[state=unchecked]:bg-muted-foreground/30",
              )}
              onCheckedChange={async (v) => {
                try {
                  await push.setNotificationsOn(v);
                  toast.success(v ? "Notifications enabled" : "Notifications turned off");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not update notifications");
                }
              }}
            />
          </div>
        </div>
      )}

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="size-8 rounded-full bg-primary/10 grid place-items-center text-xs font-semibold text-primary">
              {avatarInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate" title={showEmailUnderName ? userEmail : undefined}>
                {sidebarTitle}
              </p>
              {showEmailUnderName && (
                <p className="text-[10px] text-muted-foreground truncate" title={userEmail}>
                  {userEmail}
                </p>
              )}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Sign out">
                  <LogOut className="size-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You will be logged out of Unified Inbox Hub on this device.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={signOut}>Sign out</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: floating menu button + sheet */}
      <Sheet>
        <SheetTrigger asChild>
          <button
            className="md:hidden fixed top-3 left-3 z-40 size-10 rounded-lg bg-background border border-border shadow-sm grid place-items-center"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 max-w-[85vw]">
          {inner}
        </SheetContent>
      </Sheet>

      {/* Desktop: persistent sidebar */}
      <aside className="hidden md:flex shrink-0">
        {inner}
      </aside>
      <AccountSettingsDialog
        open={!!editAccount}
        onOpenChange={(v) => { if (!v) setEditAccount(null); }}
        account={editAccount}
        onSaved={onRefresh}
        onRemove={async (accId) => {
          const acc = accounts.find((a) => a.id === accId);
          if (!acc) return;
          await deleteAccount(acc);
          setEditAccount(null);
        }}
      />
    </>
  );
}
