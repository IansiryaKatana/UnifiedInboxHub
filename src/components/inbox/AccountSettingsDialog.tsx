import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { runGmailSyncInChunks } from "@/lib/gmailSyncChunks";
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

interface Account {
  id: string;
  email_address: string;
  display_name: string | null;
  color: string;
  provider_type: string;
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
    imap_username: "",
    imap_password: "",
    imap_use_tls: true,
    smtp_host: "",
    smtp_port: 465,
    smtp_username: "",
    smtp_password: "",
    smtp_use_tls: true,
  });
  const [showImapPassword, setShowImapPassword] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
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
      imap_username: account.imap_username ?? "",
      imap_password: "",
      imap_use_tls: account.imap_use_tls ?? true,
      smtp_host: account.smtp_host ?? "",
      smtp_port: account.smtp_port ?? 465,
      smtp_username: account.smtp_username ?? "",
      smtp_password: "",
      smtp_use_tls: account.smtp_use_tls ?? true,
    });
  }, [account?.id, open]);

  const tabProgress = tab === "setup" ? 33 : tab === "settings" ? 66 : 100;

  const save = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("account-credentials-update", {
        body: {
          account_id: account.id,
          email_address: form.email_address.trim(),
          display_name: form.display_name.trim(),
          color: form.color,
          ...(account.provider_type === "imap" ? {
            imap_host: form.imap_host.trim(),
            imap_port: Number(form.imap_port),
            imap_username: form.imap_username.trim(),
            imap_password: form.imap_password.trim() || undefined,
            imap_use_tls: form.imap_use_tls,
            smtp_host: form.smtp_host.trim(),
            smtp_port: Number(form.smtp_port),
            smtp_username: form.smtp_username.trim(),
            smtp_password: form.smtp_password.trim() || undefined,
          } : {}),
        },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Failed to save settings");
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
        const { data, error } = await supabase.functions.invoke("imap-sync", { body: { account_id: account.id } });
        if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Sync failed");
        toast.success(`Synced ${data.imported ?? 0} emails`);
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>IMAP host</Label>
                        <Input value={form.imap_host} onChange={(e) => setForm((v) => ({ ...v, imap_host: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>IMAP port</Label>
                        <Input type="number" value={form.imap_port} onChange={(e) => setForm((v) => ({ ...v, imap_port: +e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>IMAP username</Label>
                      <Input value={form.imap_username} onChange={(e) => setForm((v) => ({ ...v, imap_username: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>New IMAP password (optional)</Label>
                      <div className="relative">
                        <Input
                          type={showImapPassword ? "text" : "password"}
                          value={form.imap_password}
                          onChange={(e) => setForm((v) => ({ ...v, imap_password: e.target.value }))}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowImapPassword(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showImapPassword ? "Hide IMAP password" : "Show IMAP password"}
                        >
                          {showImapPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>SMTP host</Label>
                        <Input value={form.smtp_host} onChange={(e) => setForm((v) => ({ ...v, smtp_host: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>SMTP port</Label>
                        <Input type="number" value={form.smtp_port} onChange={(e) => setForm((v) => ({ ...v, smtp_port: +e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP username</Label>
                      <Input value={form.smtp_username} onChange={(e) => setForm((v) => ({ ...v, smtp_username: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>New SMTP password (optional)</Label>
                      <div className="relative">
                        <Input
                          type={showSmtpPassword ? "text" : "password"}
                          value={form.smtp_password}
                          onChange={(e) => setForm((v) => ({ ...v, smtp_password: e.target.value }))}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSmtpPassword(v => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showSmtpPassword ? "Hide SMTP password" : "Show SMTP password"}
                        >
                          {showSmtpPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <Label>Use TLS for IMAP</Label>
                      <Switch checked={form.imap_use_tls} onCheckedChange={(v) => setForm((x) => ({ ...x, imap_use_tls: v }))} />
                    </div>
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <Label>Use TLS for SMTP</Label>
                      <Switch checked={form.smtp_use_tls} onCheckedChange={(v) => setForm((x) => ({ ...x, smtp_use_tls: v }))} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No extra provider credentials for Gmail accounts.</p>
                )}
              </TabsContent>
              <TabsContent value="sync" className="space-y-3 m-0">
                <p className="text-sm text-muted-foreground">Manage mailbox sync and account lifecycle actions.</p>
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
