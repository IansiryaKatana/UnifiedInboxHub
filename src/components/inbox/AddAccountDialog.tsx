import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Mail, AtSign, Loader2, Eye, EyeOff, CircleCheckBig, AlertCircle, ShieldCheck, ChevronDown, Check, ChevronsUpDown } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AppPasswordSetupAlert } from "@/components/inbox/AppPasswordSetupAlert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { runGmailSyncInChunks } from "@/lib/gmailSyncChunks";
import { runImapFullSync } from "@/lib/imapSyncChunks";
import { Progress } from "@/components/ui/progress";
import {
  getMailProviderPreset,
  MAIL_PRESET_CUSTOM,
  MAIL_PRESET_NONE,
  MAIL_PROVIDER_PRESETS,
} from "@/lib/mail-provider-presets";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";
import { normalizeMailboxPassword } from "@/lib/mail-credentials";
import { withMailboxSyncPaused } from "@/lib/mailbox-sync-pause";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccountAdded: () => void | Promise<void>;
}

function parseConnectedEmailFromOAuthMessage(message: string): string | undefined {
  const m = message.match(/Connected\s+(\S+@\S+)\./i);
  return m?.[1];
}

const initialGmailFlow = () => ({
  status: "idle" as const,
  message: "",
  progress: 0,
  imported: 0,
  scanned: 0,
  connectedEmail: undefined as string | undefined,
});

const initialImapFlow = () => ({
  status: "idle" as const,
  message: "",
  progress: 0,
  imported: 0,
  mailboxTotal: undefined as number | undefined,
  connectedEmail: undefined as string | undefined,
});

const defaultImapState = () => ({
  email_address: "",
  display_name: "",
  imap_host: "",
  imap_port: 993,
  imap_password: "",
  smtp_host: "",
  smtp_port: 465,
  imap_use_tls: true,
  smtp_use_tls: true,
});

function mailProviderLabel(id: string): string {
  if (id === MAIL_PRESET_NONE) return "Choose a provider…";
  if (id === MAIL_PRESET_CUSTOM) return "My provider isn't listed";
  return getMailProviderPreset(id)?.label ?? "Choose a provider…";
}

export function AddAccountDialog({ open, onOpenChange, onAccountAdded }: Props) {
  const isMobile = useIsMobile();
  const [busy, setBusy] = useState(false);
  const [gmailFlow, setGmailFlow] = useState<ReturnType<typeof initialGmailFlow>>(initialGmailFlow);
  const [imapFlow, setImapFlow] = useState<ReturnType<typeof initialImapFlow>>(initialImapFlow);
  const popupRef = useRef<Window | null>(null);
  const popupWatchRef = useRef<number | null>(null);
  const imapLastStoredRef = useRef(0);
  const [imap, setImap] = useState(defaultImapState);
  const [imapMailProvider, setImapMailProvider] = useState<string>(MAIL_PRESET_NONE);
  const [showMailboxPassword, setShowMailboxPassword] = useState(false);
  const [gmailGuideAcknowledged, setGmailGuideAcknowledged] = useState(false);
  const [advancedServersOpen, setAdvancedServersOpen] = useState(false);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);

  const selectedProvider = getMailProviderPreset(imapMailProvider);
  const appPasswordGuide = selectedProvider?.appPasswordGuide;
  const showAdvancedServers = imapMailProvider === MAIL_PRESET_CUSTOM;

  useEffect(() => {
    if (!open) return;
    setImap(defaultImapState());
    setImapMailProvider(MAIL_PRESET_NONE);
    setShowMailboxPassword(false);
    setGmailGuideAcknowledged(false);
    setAdvancedServersOpen(false);
    setProviderPickerOpen(false);
    setImapFlow(initialImapFlow());
  }, [open]);

  const applyMailProviderPreset = (id: string) => {
    setImapMailProvider(id);
    if (id === MAIL_PRESET_CUSTOM) {
      setAdvancedServersOpen(true);
      return;
    }
    if (id === MAIL_PRESET_NONE) return;
    const preset = getMailProviderPreset(id);
    if (!preset) return;
    setImap((prev) => ({
      ...prev,
      imap_host: preset.imap_host,
      imap_port: preset.imap_port,
      imap_use_tls: preset.imap_use_tls,
      smtp_host: preset.smtp_host,
      smtp_port: preset.smtp_port,
      smtp_use_tls: preset.smtp_use_tls,
    }));
  };

  const connectGmail = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("gmail-oauth-start", {
      body: { return_to: window.location.origin, popup: true },
    });
    setBusy(false);
    if (error || !data?.url) {
      toast.error("Couldn't start Gmail connection: " + (error?.message ?? data?.error ?? "unknown"));
      return;
    }
    const features =
      "popup=yes,width=560,height=720,left=120,top=80,scrollbars=yes,resizable=yes";
    const popup = window.open("about:blank", "gmail_oauth_popup", features);
    if (!popup) {
      toast.error("Popup was blocked. Allow popups for this site and try again.");
      return;
    }
    popup.focus();
    popup.location.href = data.url;
    popupRef.current = popup;
    setGmailFlow({
      ...initialGmailFlow(),
      status: "waiting",
      message: "Finish signing in in the popup. If Google shows a warning, tap Advanced, then Go to Unified Inbox Hub.",
      progress: 20,
      imported: 0,
      scanned: 0,
    });
  };

  useEffect(() => {
    if (gmailFlow.status !== "syncing") return;
    const id = window.setInterval(() => {
      setGmailFlow((prev) => {
        if (prev.status !== "syncing") return prev;
        const next = Math.min(92, prev.progress + 6);
        return { ...prev, progress: next };
      });
    }, 450);
    return () => window.clearInterval(id);
  }, [gmailFlow.status]);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (e.data?.type !== "gmail-oauth") return;
      // Callback may post from Supabase HTML or from same-origin bridge (/gmail-oauth-popup-result.html).
      const origin = typeof e.origin === "string" ? e.origin : "";
      const trusted =
        origin === window.location.origin ||
        origin.includes(".supabase.co") ||
        origin.includes("127.0.0.1") ||
        origin.includes("localhost");
      if (!trusted) return;
      if (popupWatchRef.current) {
        window.clearInterval(popupWatchRef.current);
        popupWatchRef.current = null;
      }

      if (!e.data?.ok) {
        setGmailFlow({
          ...initialGmailFlow(),
          status: "error",
          message: e.data?.message || "Gmail connection failed. Please try again.",
          progress: 100,
          imported: 0,
          scanned: 0,
        });
        return;
      }

      const accountId: string | null = e.data?.account_id ?? null;
      const msg = String(e.data?.message ?? "");
      const fromPayload =
        typeof e.data?.connected_email === "string" ? e.data.connected_email.trim() : "";
      const connectedEmail =
        fromPayload || parseConnectedEmailFromOAuthMessage(msg);

      await onAccountAdded();

      setGmailFlow({
        status: "syncing",
        connectedEmail,
        message: connectedEmail
          ? `New Gmail account connected · ${connectedEmail}. Running first sync…`
          : "New Gmail account connected. Running first sync…",
        progress: 45,
        imported: 0,
        scanned: 0,
      });

      try {
        let targetAccountId = accountId;
        if (!targetAccountId) {
          const { data: userRes } = await supabase.auth.getUser();
          const userId = userRes.user?.id;
          if (!userId) throw new Error("Could not resolve current user");
          const { data: fallbackAccount, error: fallbackError } = await supabase
            .from("email_accounts")
            .select("id")
            .eq("user_id", userId)
            .eq("provider_type", "gmail")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          if (fallbackError || !fallbackAccount?.id) throw new Error(fallbackError?.message ?? "Could not find Gmail account");
          targetAccountId = fallbackAccount.id;
        }

        const { count: baselineCount } = await supabase
          .from("emails")
          .select("id", { count: "exact", head: true })
          .eq("account_id", targetAccountId);

        let chunkCount = 0;
        const { imported: totalImported } = await runGmailSyncInChunks(supabase, targetAccountId, {
          pageSize: 20,
          maxPagesPerChunk: 1,
          onProgress: async ({ totalImported: aggImported, hasMore }) => {
            chunkCount += 1;
            const { count: liveCount } = await supabase
              .from("emails")
              .select("id", { count: "exact", head: true })
              .eq("account_id", targetAccountId);
            const importedLive = Math.max(aggImported, Math.max(0, (liveCount ?? 0) - (baselineCount ?? 0)));
            setGmailFlow((prev) => ({
              ...prev,
              status: "syncing",
              progress: hasMore ? Math.min(95, 45 + chunkCount * 5) : 100,
              imported: importedLive,
              scanned: importedLive,
              message: hasMore
                ? `Syncing in progress... ${importedLive} emails imported so far.`
                : `Sync complete. ${importedLive} emails imported.`,
            }));
          },
        });

        await onAccountAdded();
        setGmailFlow((prev) => ({
          ...prev,
          status: "success",
          message:
            totalImported > 0
              ? `First sync finished · imported ${totalImported} messages.`
              : "First sync finished · your inbox is ready.",
          progress: 100,
          imported: totalImported,
          scanned: totalImported,
        }));
        toast.success(
          connectedEmail
            ? `${connectedEmail} connected and synced.`
            : "Gmail account connected and synced.",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setGmailFlow((prev) => ({
          ...prev,
          status: "error",
          message: `Connected, but initial sync failed: ${msg}`,
          progress: 100,
          imported: 0,
          scanned: 0,
        }));
        toast.error(`Connected, but initial sync failed: ${msg}`);
        await onAccountAdded();
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onAccountAdded]);

  useEffect(() => {
    if (gmailFlow.status !== "waiting") return;
    popupWatchRef.current = window.setInterval(() => {
      if (!popupRef.current) return;
      if (popupRef.current.closed) {
        if (popupWatchRef.current) {
          window.clearInterval(popupWatchRef.current);
          popupWatchRef.current = null;
        }
        setGmailFlow((prev) => (
          prev.status === "waiting"
            ? {
                ...initialGmailFlow(),
                status: "error",
                message: "Popup closed before completion. Please try again.",
                progress: 100,
                imported: 0,
                scanned: 0,
              }
            : prev
        ));
      }
    }, 500);
    return () => {
      if (popupWatchRef.current) {
        window.clearInterval(popupWatchRef.current);
        popupWatchRef.current = null;
      }
    };
  }, [gmailFlow.status]);

  const addImap = async () => {
    const email = imap.email_address.trim().toLowerCase();
    if (imapMailProvider === MAIL_PRESET_NONE) {
      toast.error("Choose where your email is hosted (e.g. Outlook, Hostinger).");
      return;
    }
    if (!email || !imap.imap_password?.trim()) {
      toast.error("Enter your email address and password.");
      return;
    }
    if (showAdvancedServers && (!imap.imap_host?.trim() || !imap.smtp_host?.trim())) {
      toast.error("Enter incoming and outgoing server names, or pick your provider from the list.");
      return;
    }
    if (!showAdvancedServers && !imap.imap_host?.trim()) {
      toast.error("Could not load settings for that provider. Try again or choose “My provider isn't listed”.");
      return;
    }

    await withMailboxSyncPaused(async () => {
    setBusy(true);
    setImapFlow({
      ...initialImapFlow(),
      status: "connecting",
      message: "Saving your sign-in details…",
      progress: 15,
      connectedEmail: email,
    });

    const pwd = normalizeMailboxPassword(imap.imap_password);
    const trimmed = {
      ...imap,
      email_address: email,
      imap_host: imap.imap_host.trim(),
      imap_password: pwd,
      smtp_host: imap.smtp_host.trim(),
      imap_username: email,
      smtp_username: email,
      smtp_password: pwd,
    };
    const { data, error } = await supabase.functions.invoke("account-credentials", {
      body: trimmed,
    });
    if (error || !data?.ok) {
      setBusy(false);
      setImapFlow({
        ...initialImapFlow(),
        status: "error",
        message: parseEdgeFunctionFailure(data, error),
        progress: 100,
        connectedEmail: email,
      });
      toast.error(parseEdgeFunctionFailure(data, error));
      return;
    }

    const accountId = data.account_id as string;
    await onAccountAdded();

    setImapFlow({
      status: "syncing",
      connectedEmail: email,
      message: `Connecting to ${email}…`,
      progress: 8,
      imported: 0,
      mailboxTotal: undefined,
    });
    imapLastStoredRef.current = 0;

    try {
      const { imported: totalImported } = await runImapFullSync(supabase, accountId, {
        maxMessages: 8,
        maxBackfillChunks: 50,
        onProgress: async (p) => {
          setImapFlow((prev) => ({
            ...prev,
            status: "syncing",
            progress: Math.max(prev.progress, p.progress),
            imported: p.storedInApp,
            mailboxTotal: p.mailboxTotal,
            message: p.message || (p.hasMore
              ? `Fetching emails… ${p.storedInApp} imported so far.`
              : `Sync complete · ${p.storedInApp} email${p.storedInApp === 1 ? "" : "s"} imported.`),
          }));
          if (p.storedInApp > imapLastStoredRef.current) {
            imapLastStoredRef.current = p.storedInApp;
            await onAccountAdded();
          }
        },
      });

      await onAccountAdded();
      await supabase
        .from("email_accounts")
        .update({ sync_status: "idle", last_sync_error: null })
        .eq("id", accountId);
      setImapFlow((prev) => ({
        ...prev,
        status: "success",
        message:
          totalImported > 0
            ? `First sync finished · ${totalImported} message${totalImported === 1 ? "" : "s"} imported.`
            : "Account connected · your inbox is ready.",
        progress: 100,
        imported: totalImported,
      }));
      toast.success(
        totalImported > 0
          ? `${email} connected · ${totalImported} messages imported.`
          : `${email} connected.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const timedOut =
        /546|504|compute resources|gateway timeout/i.test(msg);
      await supabase
        .from("email_accounts")
        .update({
          sync_status: "error",
          last_sync_error: timedOut
            ? "Initial sync timed out — open account settings and tap Sync to continue."
            : msg.slice(0, 500),
        })
        .eq("id", accountId);
      setImapFlow((prev) => ({
        ...prev,
        status: timedOut ? "success" : "error",
        message: timedOut
          ? `${email} is connected. Mail import timed out — use Sync in account settings to finish.`
          : `Connected, but initial sync failed: ${msg}`,
        progress: 100,
      }));
      toast[timedOut ? "success" : "error"](
        timedOut
          ? `${email} connected. Tap Sync in account settings to import mail.`
          : `Connected, but initial sync failed: ${msg}`,
      );
      await onAccountAdded();
    } finally {
      setBusy(false);
    }
    });
  };

  const handleSheetOpenChange = (next: boolean) => {
    if (!next) {
      setGmailFlow(initialGmailFlow());
      setImapFlow(initialImapFlow());
    }
    onOpenChange(next);
  };

  const imapFormLocked =
    busy || imapFlow.status === "connecting" || imapFlow.status === "syncing";

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "h-[92vh] rounded-t-2xl overflow-y-auto" : "h-screen w-[40vw] min-w-[560px] max-w-none overflow-y-auto"}
      >
        <SheetHeader>
          <SheetTitle>Add an email account</SheetTitle>
          <SheetDescription>Connect Gmail or sign in with your work or personal email.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="gmail" className="mt-2">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="gmail" className="gap-2"><Mail className="size-4" /> Gmail</TabsTrigger>
            <TabsTrigger value="imap" className="gap-2"><AtSign className="size-4" /> Other email</TabsTrigger>
          </TabsList>

          <TabsContent value="gmail" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              We&apos;ll open Google in a small window. This page stays open—you can add more than one Gmail account.
            </p>

            <Alert className="border-blue-500/25 bg-blue-500/[0.06] dark:bg-blue-950/20">
              <ShieldCheck className="size-4 text-blue-600" aria-hidden />
              <AlertTitle className="text-sm">Google might show a warning first</AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground space-y-2">
                <p>That&apos;s normal for our team app. You only do this once per account.</p>
                <p className="font-medium text-foreground">If the screen looks scary:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Tap or click <span className="font-medium text-foreground">Advanced</span> (bottom left)</li>
                  <li>Then <span className="font-medium text-foreground">Go to Unified Inbox Hub</span></li>
                  <li>Allow access when asked</li>
                </ol>
              </AlertDescription>
            </Alert>

            {!gmailGuideAcknowledged ? (
              <Button
                onClick={() => setGmailGuideAcknowledged(true)}
                disabled={busy || gmailFlow.status === "waiting" || gmailFlow.status === "syncing"}
                className="w-full gap-2"
              >
                <ShieldCheck className="size-4" />
                Got it — continue
              </Button>
            ) : (
              <Button onClick={connectGmail} disabled={busy || gmailFlow.status === "waiting" || gmailFlow.status === "syncing"} className="w-full gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                Sign in with Google
              </Button>
            )}

            {(gmailFlow.status === "waiting" || gmailFlow.status === "syncing") && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium">
                  {gmailFlow.status === "waiting" ? "Waiting for Google sign-in" : "Syncing your inbox"}
                </p>
                <p className="text-xs text-muted-foreground">{gmailFlow.message}</p>
                <Progress value={gmailFlow.progress} className="h-2" />
                {gmailFlow.status === "waiting" && (
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>Finish signing in in the popup. Your account shows up in the sidebar when it&apos;s done.</p>
                    <p>
                      See a red warning? <span className="font-medium text-foreground">Advanced</span> →{" "}
                      <span className="font-medium text-foreground">Go to Unified Inbox Hub</span>.
                    </p>
                  </div>
                )}
              </div>
            )}

            {gmailFlow.status === "success" && (
              <div className="rounded-lg border border-green-600/25 bg-green-500/[0.06] dark:bg-green-950/30 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <CircleCheckBig className="size-5 text-green-600 shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 text-left space-y-1">
                    <p className="text-sm font-semibold text-foreground">New Gmail account connected</p>
                    {gmailFlow.connectedEmail ? (
                      <p className="text-sm font-medium text-foreground truncate">{gmailFlow.connectedEmail}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{gmailFlow.message}</p>
                    {gmailFlow.imported > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Imported {gmailFlow.imported} message{gmailFlow.imported === 1 ? "" : "s"} in this first sync.
                      </p>
                    ) : null}
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => {
                    setGmailFlow(initialGmailFlow());
                    onOpenChange(false);
                  }}
                >
                  Done
                </Button>
              </div>
            )}

            {gmailFlow.status === "error" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 text-left space-y-1">
                    <p className="text-sm font-semibold">Could not finish connecting</p>
                    <p className="text-xs text-muted-foreground">{gmailFlow.message}</p>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setGmailFlow(initialGmailFlow())}>
                  Dismiss
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="imap" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Pick who hosts your email, then sign in with the same address and password you use in Outlook, Apple Mail, or your phone.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="imap-mail-provider" className="text-base font-medium">
                Where is your email hosted?
              </Label>
              <Popover open={providerPickerOpen} onOpenChange={setProviderPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="imap-mail-provider"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={providerPickerOpen}
                    disabled={imapFormLocked}
                    className="w-full h-11 justify-between font-normal"
                  >
                    <span className={cn("truncate", imapMailProvider === MAIL_PRESET_NONE && "text-muted-foreground")}>
                      {mailProviderLabel(imapMailProvider)}
                    </span>
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search providers…" />
                    <CommandList>
                      <CommandEmpty>No provider found.</CommandEmpty>
                      <CommandGroup>
                        {MAIL_PROVIDER_PRESETS.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.label} ${p.hint ?? ""}`}
                            onSelect={() => {
                              applyMailProviderPreset(p.id);
                              setProviderPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 size-4 shrink-0",
                                imapMailProvider === p.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="min-w-0">
                              <p className="truncate">{p.label}</p>
                              {p.hint ? <p className="text-xs text-muted-foreground truncate">{p.hint}</p> : null}
                            </div>
                          </CommandItem>
                        ))}
                        <CommandItem
                          value="My provider isn't listed"
                          onSelect={() => {
                            applyMailProviderPreset(MAIL_PRESET_CUSTOM);
                            setProviderPickerOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-4 shrink-0",
                              imapMailProvider === MAIL_PRESET_CUSTOM ? "opacity-100" : "opacity-0",
                            )}
                          />
                          My provider isn&apos;t listed
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedProvider?.hint ? (
                <p className="text-xs text-muted-foreground">{selectedProvider.hint}</p>
              ) : imapMailProvider !== MAIL_PRESET_NONE && !showAdvancedServers ? (
                <p className="text-xs text-muted-foreground">We&apos;ll connect using {selectedProvider?.label}&apos;s usual settings.</p>
              ) : null}
            </div>

            {imapMailProvider !== MAIL_PRESET_NONE && (
              <div className="space-y-3">
                {appPasswordGuide ? <AppPasswordSetupAlert guide={appPasswordGuide} /> : null}

                <div className="space-y-1.5">
                  <Label htmlFor="imap-email">Email address</Label>
                  <Input
                    id="imap-email"
                    value={imap.email_address}
                    onChange={(e) => setImap({ ...imap, email_address: e.target.value })}
                    placeholder={appPasswordGuide?.emailPlaceholder ?? "Hello@capitaldreamdubai.com"}
                    autoComplete="email"
                    disabled={imapFormLocked}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="imap-password">
                    {appPasswordGuide?.passwordFieldLabel ?? "Email password"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="imap-password"
                      type={showMailboxPassword ? "text" : "password"}
                      value={imap.imap_password}
                      onChange={(e) => setImap({ ...imap, imap_password: e.target.value })}
                      placeholder={
                        appPasswordGuide?.passwordPlaceholder ?? "Same password you use to check mail"
                      }
                      className="pr-10"
                      autoComplete="current-password"
                      disabled={imapFormLocked}
                    />
                    <button
                      type="button"
                      onClick={() => setShowMailboxPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showMailboxPassword ? "Hide password" : "Show password"}
                    >
                      {showMailboxPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {appPasswordGuide ? (
                    <p className="text-[11px] text-muted-foreground">{appPasswordGuide.passwordHint}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Usually the same password you use in your email app or webmail.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="imap-display-name">Name on outgoing mail <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="imap-display-name"
                    value={imap.display_name}
                    onChange={(e) => setImap({ ...imap, display_name: e.target.value })}
                    placeholder="Your name e.g. Disna Perera"
                    disabled={imapFormLocked}
                  />
                </div>
              </div>
            )}

            {showAdvancedServers && (
              <Collapsible open={advancedServersOpen} onOpenChange={setAdvancedServersOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between px-2 h-9 text-muted-foreground">
                    Server settings
                    <ChevronDown className={`size-4 transition-transform ${advancedServersOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Only fill these in if your IT team gave you specific server names.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="imap-host">Incoming mail server</Label>
                      <Input
                        id="imap-host"
                        value={imap.imap_host}
                        onChange={(e) => setImap({ ...imap, imap_host: e.target.value })}
                        placeholder="imap.example.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="imap-port">Incoming port</Label>
                      <Input
                        id="imap-port"
                        type="number"
                        value={imap.imap_port}
                        onChange={(e) => setImap({ ...imap, imap_port: +e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-host">Outgoing mail server</Label>
                      <Input
                        id="smtp-host"
                        value={imap.smtp_host}
                        onChange={(e) => setImap({ ...imap, smtp_host: e.target.value })}
                        placeholder="smtp.example.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-port">Outgoing port</Label>
                      <Input
                        id="smtp-port"
                        type="number"
                        value={imap.smtp_port}
                        onChange={(e) => setImap({ ...imap, smtp_port: +e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border p-3">
                      <div>
                        <Label className="text-sm">Secure incoming connection</Label>
                        <p className="text-[11px] text-muted-foreground">Leave on unless IT told you otherwise.</p>
                      </div>
                      <Switch checked={imap.imap_use_tls} onCheckedChange={v => setImap({ ...imap, imap_use_tls: v, imap_port: v ? 993 : 143 })} />
                    </div>
                    <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border p-3">
                      <div>
                        <Label className="text-sm">Secure outgoing connection</Label>
                        <p className="text-[11px] text-muted-foreground">Leave on unless IT told you otherwise.</p>
                      </div>
                      <Switch checked={imap.smtp_use_tls} onCheckedChange={v => setImap({ ...imap, smtp_use_tls: v, smtp_port: v ? 465 : 587 })} />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {imapFlow.status === "idle" && (
              <Button
                onClick={addImap}
                disabled={imapMailProvider === MAIL_PRESET_NONE}
                className="w-full gap-2"
              >
                <AtSign className="size-4" />
                Connect email
              </Button>
            )}

            {(imapFlow.status === "connecting" || imapFlow.status === "syncing") && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-primary shrink-0" aria-hidden />
                  <p className="text-sm font-medium">
                    {imapFlow.status === "connecting" ? "Connecting account" : "Fetching your emails"}
                  </p>
                </div>
                {imapFlow.connectedEmail ? (
                  <p className="text-xs font-medium text-foreground truncate">{imapFlow.connectedEmail}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">{imapFlow.message}</p>
                <Progress value={imapFlow.progress} className="h-2" />
                {imapFlow.status === "syncing" && imapFlow.mailboxTotal && imapFlow.mailboxTotal > 0 ? (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {imapFlow.imported} of ~{imapFlow.mailboxTotal} messages in mailbox
                  </p>
                ) : imapFlow.status === "syncing" && imapFlow.imported > 0 ? (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {imapFlow.imported} message{imapFlow.imported === 1 ? "" : "s"} imported so far
                  </p>
                ) : null}
                {imapFlow.status === "syncing" && imapFlow.imported > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    New messages appear in your inbox list as they arrive — no need to refresh the page.
                  </p>
                ) : imapFlow.status === "syncing" ? (
                  <p className="text-[11px] text-muted-foreground">
                    This may take a minute for larger mailboxes. Your inbox updates automatically.
                  </p>
                ) : null}
              </div>
            )}

            {imapFlow.status === "success" && (
              <div className="rounded-lg border border-green-600/25 bg-green-500/[0.06] dark:bg-green-950/30 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <CircleCheckBig className="size-5 text-green-600 shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 text-left space-y-1">
                    <p className="text-sm font-semibold text-foreground">Email account connected</p>
                    {imapFlow.connectedEmail ? (
                      <p className="text-sm font-medium text-foreground truncate">{imapFlow.connectedEmail}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{imapFlow.message}</p>
                    {imapFlow.imported > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Check the inbox list — {imapFlow.imported} message{imapFlow.imported === 1 ? "" : "s"} are already there.
                      </p>
                    ) : null}
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => {
                    setImapFlow(initialImapFlow());
                    onOpenChange(false);
                  }}
                >
                  Done
                </Button>
              </div>
            )}

            {imapFlow.status === "error" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 text-left space-y-1">
                    <p className="text-sm font-semibold">Could not finish setup</p>
                    <p className="text-xs text-muted-foreground">{imapFlow.message}</p>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setImapFlow(initialImapFlow())}>
                  Try again
                </Button>
              </div>
            )}

            {imapFlow.status === "idle" && (
              <p className="text-[11px] text-muted-foreground text-center">
                Your sign-in details are encrypted and only used to sync your inbox.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
