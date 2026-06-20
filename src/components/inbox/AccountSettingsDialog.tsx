import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { runGmailSyncInChunks } from "@/lib/gmailSyncChunks";
import { runImapSyncInChunks } from "@/lib/imapSyncChunks";
import { toast } from "sonner";
import { Loader2, RefreshCw, Trash2, Eye, EyeOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { parseEdgeFunctionFailure } from "@/lib/edge-function-error";
import { normalizeMailboxPassword } from "@/lib/mail-credentials";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AppPasswordSetupAlert } from "@/components/inbox/AppPasswordSetupAlert";
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
  matchMailProviderPresetFromHosts,
} from "@/lib/mail-provider-presets";

interface Account {
  id: string;
  email_address: string;
  display_name: string | null;
  color: string;
  provider_type: string;
  last_sync_error?: string | null;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_username?: string | null;
  imap_use_tls?: boolean | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_username?: string | null;
  smtp_use_tls?: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account | null;
  onSaved: () => Promise<void> | void;
  onRemove?: (accountId: string) => Promise<void> | void;
}

export function AccountSettingsDialog({ open, onOpenChange, account, onSaved, onRemove }: Props) {
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState<"setup" | "settings" | "sync">("setup");
  const [form, setForm] = useState({
    email_address: "",
    display_name: "",
    color: "#3b82f6",
    imap_host: "",
    imap_port: 993,
    imap_use_tls: true,
    smtp_host: "",
    smtp_port: 465,
    smtp_use_tls: true,
    mailbox_password: "",
  });
  const [imapMailProvider, setImapMailProvider] = useState<string>(MAIL_PRESET_NONE);
  const settingsAppPasswordGuide = getMailProviderPreset(imapMailProvider)?.appPasswordGuide;
  const [showMailboxPassword, setShowMailboxPassword] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) setRemoveConfirmOpen(false);
  }, [open]);

  useEffect(() => {
    if (!account) return;
    setForm({
      email_address: account.email_address ?? "",
      display_name: account.display_name ?? "",
      color: account.color ?? "#3b82f6",
      imap_host: account.imap_host ?? "",
      imap_port: account.imap_port ?? 993,
      imap_use_tls: account.imap_use_tls ?? true,
      smtp_host: account.smtp_host ?? "",
      smtp_port: account.smtp_port ?? 465,
      smtp_use_tls: account.smtp_use_tls ?? true,
      mailbox_password: "",
    });
    setImapMailProvider(
      account.provider_type === "imap"
        ? matchMailProviderPresetFromHosts(account.imap_host ?? "", account.smtp_host ?? "")
        : MAIL_PRESET_NONE,
    );
    setShowMailboxPassword(false);
  }, [account?.id, open]);

  const applyMailProviderPreset = (id: string) => {
    setImapMailProvider(id);
    if (id === MAIL_PRESET_NONE || id === MAIL_PRESET_CUSTOM) return;
    const preset = getMailProviderPreset(id);
    if (!preset) return;
    setForm((prev) => ({
      ...prev,
      imap_host: preset.imap_host,
      imap_port: preset.imap_port,
      imap_use_tls: preset.imap_use_tls,
      smtp_host: preset.smtp_host,
      smtp_port: preset.smtp_port,
      smtp_use_tls: preset.smtp_use_tls,
    }));
  };

  const tabProgress = tab === "setup" ? 33 : tab === "settings" ? 66 : 100;

  const save = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const email = form.email_address.trim();
      const mailboxPassword = form.mailbox_password.trim()
        ? normalizeMailboxPassword(form.mailbox_password)
        : undefined;
      const { data, error } = await supabase.functions.invoke("account-credentials-update", {
        body: {
          account_id: account.id,
          email_address: email,
          display_name: form.display_name.trim(),
          color: form.color,
          ...(account.provider_type === "imap"
            ? {
                imap_host: form.imap_host.trim(),
                imap_port: Number(form.imap_port),
                imap_username: email,
                imap_password: mailboxPassword,
                imap_use_tls: form.imap_use_tls,
                smtp_host: form.smtp_host.trim(),
                smtp_port: Number(form.smtp_port),
                smtp_username: email,
                smtp_password: mailboxPassword,
              }
            : {}),
        },
      });
      if (error || !data?.ok) throw new Error(parseEdgeFunctionFailure(data, error));
      toast.success("Account settings updated.");
      await onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    if (!account) return;
    setSyncing(true);
    try {
      if (account.provider_type === "gmail") {
        const { imported } = await runGmailSyncInChunks(supabase, account.id, {
          maxPagesPerChunk: 1,
          pageSize: 20,
        });
        toast.success(imported > 0 ? `Imported ${imported} new messages` : "Inbox is up to date");
      } else {
        const { imported } = await runImapSyncInChunks(supabase, account.id, {
          maxMessages: 25,
        });
        toast.success(imported > 0 ? `Imported ${imported} messages` : "Inbox is up to date");
      }
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const executeRemoveAccount = async () => {
    if (!account) return;
    setRemoving(true);
    try {
      if (onRemove) {
        await onRemove(account.id);
      } else {
        await supabase.from("emails").delete().eq("account_id", account.id);
        await supabase.from("email_threads").delete().eq("account_id", account.id);
        const { error } = await supabase.from("email_accounts").delete().eq("id", account.id);
        if (error) throw new Error(error.message);
      }
      toast.success("Account removed");
      setRemoveConfirmOpen(false);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "h-[90vh] rounded-t-2xl p-0 flex flex-col" : "h-screen w-[40vw] min-w-[560px] max-w-none p-0 flex flex-col"}
      >
        <SheetHeader className="px-4 md:px-6 py-4 border-b border-border">
          <SheetTitle>Edit account</SheetTitle>
          <SheetDescription>Update inbox color and mailbox credentials.</SheetDescription>
        </SheetHeader>
        <div className="px-4 md:px-6 pt-2 pb-1 border-b border-border/60">
          <Progress value={tabProgress} className="h-1.5 rounded-full" />
        </div>

        {!account ? null : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "setup" | "settings" | "sync")} className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 md:px-6 pt-3 shrink-0">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="sync">Sync</TabsTrigger>
              </TabsList>
            </div>
            <div className="px-4 md:px-6 py-4 flex-1 min-h-0 overflow-y-auto">
              <TabsContent value="setup" className="space-y-3 m-0">
                <div className="space-y-1.5">
                  <Label>Email address</Label>
                  <Input value={form.email_address} onChange={(e) => setForm((v) => ({ ...v, email_address: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Display name</Label>
                  <Input value={form.display_name} onChange={(e) => setForm((v) => ({ ...v, display_name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Inbox color</Label>
                  <div className="flex items-center gap-3">
                    <Input type="color" value={form.color} onChange={(e) => setForm((v) => ({ ...v, color: e.target.value }))} className="h-10 w-14 p-1" />
                    <Input value={form.color} onChange={(e) => setForm((v) => ({ ...v, color: e.target.value }))} />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="settings" className="space-y-3 m-0">
                {account.provider_type === "imap" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Same layout as “Add account”: pick a provider to fill hosts and ports. IMAP/SMTP usernames use your
                      email from Setup. Enter a new password only if you want to replace the stored mailbox password.
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-imap-provider">Mail provider</Label>
                      <Select value={imapMailProvider} onValueChange={applyMailProviderPreset}>
                        <SelectTrigger id="edit-imap-provider" className="w-full">
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
                    {settingsAppPasswordGuide ? (
                      <AppPasswordSetupAlert guide={settingsAppPasswordGuide} />
                    ) : null}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>IMAP host</Label>
                        <Input value={form.imap_host} onChange={(e) => setForm((v) => ({ ...v, imap_host: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>IMAP port</Label>
                        <Input type="number" value={form.imap_port} onChange={(e) => setForm((v) => ({ ...v, imap_port: +e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>SMTP host</Label>
                        <Input value={form.smtp_host} onChange={(e) => setForm((v) => ({ ...v, smtp_host: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>SMTP port</Label>
                        <Input type="number" value={form.smtp_port} onChange={(e) => setForm((v) => ({ ...v, smtp_port: +e.target.value }))} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>
                          {settingsAppPasswordGuide?.passwordFieldLabel ?? "New mailbox password (optional)"}
                        </Label>
                        <p className="text-[11px] text-muted-foreground -mt-0.5 mb-1">
                          {settingsAppPasswordGuide
                            ? settingsAppPasswordGuide.passwordHint
                            : "Applies to both IMAP and SMTP. Leave blank to keep the current password."}
                        </p>
                        <div className="relative">
                          <Input
                            type={showMailboxPassword ? "text" : "password"}
                            value={form.mailbox_password}
                            onChange={(e) => setForm((v) => ({ ...v, mailbox_password: e.target.value }))}
                            placeholder={
                              settingsAppPasswordGuide?.passwordPlaceholder ?? "Leave blank to keep current password"
                            }
                            className="pr-10"
                            autoComplete="new-password"
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
                      <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border p-3">
                        <div>
                          <Label className="text-sm">Use SSL/TLS for IMAP</Label>
                          <p className="text-[11px] text-muted-foreground">On for port 993. Off for 143 (STARTTLS).</p>
                        </div>
                        <Switch
                          checked={form.imap_use_tls}
                          onCheckedChange={(v) => setForm((x) => ({ ...x, imap_use_tls: v, imap_port: v ? 993 : 143 }))}
                        />
                      </div>
                      <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border p-3">
                        <div>
                          <Label className="text-sm">Use SSL/TLS for SMTP</Label>
                          <p className="text-[11px] text-muted-foreground">On for port 465. Off for 587 (STARTTLS).</p>
                        </div>
                        <Switch
                          checked={form.smtp_use_tls}
                          onCheckedChange={(v) => setForm((x) => ({ ...x, smtp_use_tls: v, smtp_port: v ? 465 : 587 }))}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No extra provider credentials for Gmail accounts.</p>
                )}
              </TabsContent>
              <TabsContent value="sync" className="space-y-3 m-0">
                {account.provider_type === "imap" && account.last_sync_error ? (
                  <Alert variant="destructive" className="py-2">
                    <AlertTitle className="text-sm">Last sync error</AlertTitle>
                    <AlertDescription className="text-xs break-words">{account.last_sync_error}</AlertDescription>
                  </Alert>
                ) : null}
                <Button onClick={syncNow} disabled={syncing} className="w-full gap-2">
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {syncing ? "Syncing..." : "Sync now"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setRemoveConfirmOpen(true)}
                  disabled={removing}
                  className="w-full gap-2"
                >
                  <Trash2 className="size-4" />
                  Remove account
                </Button>
              </TabsContent>
            </div>
            <div className="border-t border-border px-4 md:px-6 py-3 pb-[max(12px,env(safe-area-inset-bottom))] flex justify-end gap-2 shrink-0 bg-background">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || syncing || removing}>Close</Button>
              <Button onClick={save} disabled={saving || syncing || removing}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>

    <AlertDialog
      open={removeConfirmOpen}
      onOpenChange={(next) => {
        if (!removing) setRemoveConfirmOpen(next);
      }}
    >
      <AlertDialogContent className="gap-3 p-4 sm:p-5">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this account?</AlertDialogTitle>
          <AlertDialogDescription>
            {account
              ? `All synced mail for ${account.email_address} will be deleted from this app. This cannot be undone.`
              : "This account will be removed. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={removing}
            className="gap-2 sm:ml-0"
            onClick={() => void executeRemoveAccount()}
          >
            {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {removing ? "Removing…" : "Remove account"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
