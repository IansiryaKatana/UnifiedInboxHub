import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Mail, Server, Loader2, Eye, EyeOff, CircleCheckBig, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { runGmailSyncInChunks } from "@/lib/gmailSyncChunks";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getMailProviderPreset,
  MAIL_PRESET_CUSTOM,
  MAIL_PRESET_NONE,
  MAIL_PROVIDER_PRESETS,
} from "@/lib/mail-provider-presets";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";

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

export function AddAccountDialog({ open, onOpenChange, onAccountAdded }: Props) {
  const isMobile = useIsMobile();
  const [busy, setBusy] = useState(false);
  const [gmailFlow, setGmailFlow] = useState<ReturnType<typeof initialGmailFlow>>(initialGmailFlow);
  const popupRef = useRef<Window | null>(null);
  const popupWatchRef = useRef<number | null>(null);
  const [imap, setImap] = useState(defaultImapState);
  const [imapMailProvider, setImapMailProvider] = useState<string>(MAIL_PRESET_NONE);
  const [showMailboxPassword, setShowMailboxPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setImap(defaultImapState());
    setImapMailProvider(MAIL_PRESET_NONE);
    setShowMailboxPassword(false);
  }, [open]);

  const applyMailProviderPreset = (id: string) => {
    setImapMailProvider(id);
    if (id === MAIL_PRESET_NONE || id === MAIL_PRESET_CUSTOM) return;
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
      message: "Complete Google sign-in in the popup—your inbox stays open here.",
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
    const email = imap.email_address.trim();
    if (!email || !imap.imap_host?.trim() || !imap.imap_password?.trim() || !imap.smtp_host?.trim()) {
      toast.error("Fill email, password, and server fields (or pick a mail provider)");
      return;
    }
    setBusy(true);
    const pwd = imap.imap_password.trim();
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
    setBusy(false);
    if (error || !data?.ok) {
      toast.error(parseEdgeFunctionFailure(data, error));
      return;
    }
    toast.success("Account added. Fetching mail…");
    onAccountAdded();
    onOpenChange(false);
    const syncRes = await supabase.functions.invoke("imap-sync", {
      body: { account_id: data.account_id, max_messages: 250 },
    });
    if (syncRes.error || !syncRes.data?.ok) {
      toast.error(parseEdgeFunctionFailure(syncRes.data, syncRes.error));
    }
    onAccountAdded();
  };

  const handleSheetOpenChange = (next: boolean) => {
    if (!next) setGmailFlow(initialGmailFlow());
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "h-[92vh] rounded-t-2xl overflow-y-auto" : "h-screen w-[40vw] min-w-[560px] max-w-none overflow-y-auto"}
      >
        <SheetHeader>
          <SheetTitle>Add an email account</SheetTitle>
          <SheetDescription>Connect Gmail or a custom IMAP/SMTP mailbox.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="gmail" className="mt-2">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="gmail" className="gap-2"><Mail className="size-4" /> Gmail</TabsTrigger>
            <TabsTrigger value="imap" className="gap-2"><Server className="size-4" /> IMAP / SMTP</TabsTrigger>
          </TabsList>

          <TabsContent value="gmail" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Sign in with Google in the popup—this app stays open. You can connect multiple Gmail accounts.
            </p>
            <Button onClick={connectGmail} disabled={busy || gmailFlow.status === "waiting" || gmailFlow.status === "syncing"} className="w-full gap-2">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Connect Gmail
            </Button>

            {(gmailFlow.status === "waiting" || gmailFlow.status === "syncing") && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium">
                  {gmailFlow.status === "waiting" ? "Waiting for Google sign-in" : "Syncing your inbox"}
                </p>
                <p className="text-xs text-muted-foreground">{gmailFlow.message}</p>
                <Progress value={gmailFlow.progress} className="h-2" />
                {gmailFlow.status === "waiting" && (
                  <p className="text-[11px] text-muted-foreground">
                    Finish authorization in the popup. Your account appears in the sidebar as soon as it connects.
                  </p>
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

          <TabsContent value="imap" className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Choose your mail provider to fill server names and ports, then enter your email and password. Usernames for
              IMAP/SMTP match your email; the same password is used for both unless you edit the account later.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="imap-mail-provider">Mail provider</Label>
              <Select value={imapMailProvider} onValueChange={applyMailProviderPreset}>
                <SelectTrigger id="imap-mail-provider" className="w-full">
                  <SelectValue placeholder="Choose provider…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MAIL_PRESET_NONE}>Let me enter servers manually</SelectItem>
                  {MAIL_PROVIDER_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} title={p.hint}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={MAIL_PRESET_CUSTOM}>Other — keep current fields, edit below</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Email address</Label>
                <Input
                  value={imap.email_address}
                  onChange={(e) => setImap({ ...imap, email_address: e.target.value })}
                  placeholder="info@yourdomain.com"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Display name (optional)</Label>
                <Input value={imap.display_name} onChange={e => setImap({ ...imap, display_name: e.target.value })} placeholder="Info — Your Brand" />
              </div>
              <div className="space-y-1.5">
                <Label>IMAP host</Label>
                <Input value={imap.imap_host} onChange={e => setImap({ ...imap, imap_host: e.target.value })} placeholder="imap.yourdomain.com" />
              </div>
              <div className="space-y-1.5">
                <Label>IMAP port</Label>
                <Input type="number" value={imap.imap_port} onChange={e => setImap({ ...imap, imap_port: +e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Password</Label>
                <p className="text-[11px] text-muted-foreground -mt-0.5 mb-1">
                  Same password is sent for IMAP and SMTP login (your provider’s mailbox password).
                </p>
                <div className="relative">
                  <Input
                    type={showMailboxPassword ? "text" : "password"}
                    value={imap.imap_password}
                    onChange={(e) => setImap({ ...imap, imap_password: e.target.value })}
                    placeholder="••••••••"
                    className="pr-10"
                    autoComplete="current-password"
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
              </div>
              <div className="space-y-1.5">
                <Label>SMTP host</Label>
                <Input value={imap.smtp_host} onChange={e => setImap({ ...imap, smtp_host: e.target.value })} placeholder="smtp.yourdomain.com" />
              </div>
              <div className="space-y-1.5">
                <Label>SMTP port</Label>
                <Input type="number" value={imap.smtp_port} onChange={e => setImap({ ...imap, smtp_port: +e.target.value })} />
              </div>
              <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border p-3">
                <div>
                  <Label className="text-sm">Use SSL/TLS for IMAP</Label>
                  <p className="text-[11px] text-muted-foreground">On for port 993 (recommended). Off for 143 (STARTTLS/plain).</p>
                </div>
                <Switch checked={imap.imap_use_tls} onCheckedChange={v => setImap({ ...imap, imap_use_tls: v, imap_port: v ? 993 : 143 })} />
              </div>
              <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border p-3">
                <div>
                  <Label className="text-sm">Use SSL/TLS for SMTP</Label>
                  <p className="text-[11px] text-muted-foreground">On for port 465. Off for 587 (STARTTLS).</p>
                </div>
                <Switch checked={imap.smtp_use_tls} onCheckedChange={v => setImap({ ...imap, smtp_use_tls: v, smtp_port: v ? 465 : 587 })} />
              </div>
            </div>
            <Button onClick={addImap} disabled={busy} className="w-full gap-2">
              {busy && <Loader2 className="size-4 animate-spin" />}
              Add account
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Credentials are encrypted server-side and only used to fetch and send mail on your behalf.
            </p>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
