import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Clock, Ban, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { ControlSidebar } from "./ControlSidebar";
import { AccessDurationFields } from "./AccessDurationFields";
import {
  addDaysFromNow,
  buildAccessDurationPayload,
  createAdminUser,
  extendAdminUserAccess,
  formatAccessExpiry,
  listAdminUsers,
  revokeAdminUserAccess,
  toDatetimeLocalValue,
  type AccessDurationMode,
  type AdminUserRow,
  type RelativeTimeUnit,
} from "@/lib/admin-users";

const defaultExactUntil = () => toDatetimeLocalValue(addDaysFromNow(30));

function statusBadge(status: AdminUserRow["status"]) {
  if (status === "admin") return <Badge>Admin</Badge>;
  if (status === "active") return <Badge variant="secondary">Active</Badge>;
  return <Badge variant="destructive">Expired</Badge>;
}

type Props = {
  onSignOut: () => Promise<void>;
};

export function ControlDashboard({ onSignOut }: Props) {
  const isMobile = useIsMobile();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [extendTarget, setExtendTarget] = useState<AdminUserRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminUserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createName, setCreateName] = useState("");
  const [createMode, setCreateMode] = useState<AccessDurationMode>("preset");
  const [createPresetDays, setCreatePresetDays] = useState(30);
  const [createAddAmount, setCreateAddAmount] = useState(30);
  const [createAddUnit, setCreateAddUnit] = useState<RelativeTimeUnit>("days");
  const [createExactUntil, setCreateExactUntil] = useState(defaultExactUntil);

  const [extendMode, setExtendMode] = useState<AccessDurationMode>("add");
  const [extendPresetDays, setExtendPresetDays] = useState(30);
  const [extendAddAmount, setExtendAddAmount] = useState(30);
  const [extendAddUnit, setExtendAddUnit] = useState<RelativeTimeUnit>("days");
  const [extendExactUntil, setExtendExactUntil] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await listAdminUsers());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (extendTarget) {
      setExtendMode("add");
      setExtendPresetDays(30);
      setExtendAddAmount(30);
      setExtendAddUnit("days");
      const base = extendTarget.access_expires_at ?? new Date().toISOString();
      setExtendExactUntil(toDatetimeLocalValue(base));
    }
  }, [extendTarget]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const duration = buildAccessDurationPayload(createMode, {
      presetDays: createPresetDays,
      addAmount: createAddAmount,
      addUnit: createAddUnit,
      exactUntil: createExactUntil,
    });
    if (!duration) {
      toast.error("Set a valid access duration.");
      return;
    }
    setBusy(true);
    try {
      await createAdminUser({
        email: createEmail.trim(),
        password: createPassword,
        display_name: createName.trim() || undefined,
        ...duration,
      });
      toast.success("User created");
      setCreateOpen(false);
      setCreateEmail("");
      setCreatePassword("");
      setCreateName("");
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const handleExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendTarget) return;
    const duration = buildAccessDurationPayload(extendMode, {
      presetDays: extendPresetDays,
      addAmount: extendAddAmount,
      addUnit: extendAddUnit,
      exactUntil: extendExactUntil,
    });
    if (!duration) {
      toast.error("Set a valid extension.");
      return;
    }
    setBusy(true);
    try {
      await extendAdminUserAccess({
        user_id: extendTarget.id,
        ...duration,
      });
      toast.success("Access extended");
      setExtendTarget(null);
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extend failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await revokeAdminUserAccess(revokeTarget.id);
      toast.success("Access revoked");
      setRevokeTarget(null);
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await onSignOut();
    setSigningOut(false);
  };

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-background">
      <ControlSidebar onCreateUser={() => setCreateOpen(true)} onSignOut={handleSignOut} signingOut={signingOut} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b px-4 py-4 md:pl-4 pl-14">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">User access</h1>
              <p className="text-sm text-muted-foreground">Create accounts and manage access duration.</p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => void loadUsers()} disabled={loading}>
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">No users yet.</div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader className="max-md:hidden">
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id} className="max-md:flex max-md:flex-col max-md:gap-3 max-md:p-4">
                      <TableCell className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-0 md:font-medium">
                        <span className="text-xs font-medium text-muted-foreground md:hidden">Name</span>
                        <span className="truncate">{u.display_name || "—"}</span>
                      </TableCell>
                      <TableCell className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-0">
                        <span className="text-xs font-medium text-muted-foreground md:hidden">Email</span>
                        <span className="truncate">{u.email}</span>
                      </TableCell>
                      <TableCell className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-0">
                        <span className="text-xs font-medium text-muted-foreground md:hidden">Status</span>
                        {statusBadge(u.status)}
                      </TableCell>
                      <TableCell className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-0 text-muted-foreground">
                        <span className="text-xs font-medium md:hidden">Expires</span>
                        <span className="text-sm md:text-inherit">
                          {u.status === "admin" ? "No expiry" : formatAccessExpiry(u.access_expires_at)}
                        </span>
                      </TableCell>
                      <TableCell className="max-md:flex max-md:flex-wrap max-md:gap-2 max-md:p-0 md:text-right">
                        <span className="w-full text-xs font-medium text-muted-foreground md:hidden">Actions</span>
                        {u.status !== "admin" ? (
                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => setExtendTarget(u)}>
                              <Clock className="size-3.5" />
                              Extend
                            </Button>
                            <Button variant="outline" size="sm" className="gap-1.5 h-8 text-destructive" onClick={() => setRevokeTarget(u)}>
                              <Ban className="size-3.5" />
                              Revoke
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={isMobile ? "max-h-[90dvh] overflow-y-auto mb-0" : ""}>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>Set credentials and how long this user can access the app.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-email">Email</Label>
              <Input id="create-email" type="email" required placeholder="user@company.com" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-name">Display name</Label>
              <Input id="create-name" placeholder="Optional display name" value={createName} onChange={(e) => setCreateName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-password">Temporary password</Label>
              <Input id="create-password" type="password" required minLength={8} placeholder="Min. 8 characters" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} />
            </div>
            <AccessDurationFields
              mode={createMode}
              onModeChange={setCreateMode}
              presetDays={createPresetDays}
              onPresetChange={setCreatePresetDays}
              addAmount={createAddAmount}
              onAddAmountChange={setCreateAddAmount}
              addUnit={createAddUnit}
              onAddUnitChange={setCreateAddUnit}
              exactUntil={createExactUntil}
              onExactUntilChange={setCreateExactUntil}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Create user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extendTarget} onOpenChange={(open) => !open && setExtendTarget(null)}>
        <DialogContent className={isMobile ? "max-h-[90dvh] overflow-y-auto mb-0" : ""}>
          <DialogHeader>
            <DialogTitle>Extend access</DialogTitle>
            <DialogDescription>
              {extendTarget ? `Adjust access for ${extendTarget.email}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleExtend} className="space-y-4">
            <AccessDurationFields
              mode={extendMode}
              onModeChange={setExtendMode}
              presetDays={extendPresetDays}
              onPresetChange={setExtendPresetDays}
              addAmount={extendAddAmount}
              onAddAmountChange={setExtendAddAmount}
              addUnit={extendAddUnit}
              onAddUnitChange={setExtendAddUnit}
              exactUntil={extendExactUntil}
              onExactUntilChange={setExtendExactUntil}
              baseIso={extendTarget?.access_expires_at}
              currentExpiryLabel={extendTarget ? formatAccessExpiry(extendTarget.access_expires_at) : undefined}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setExtendTarget(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Save extension
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access now?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget ? `${revokeTarget.email} will be signed out and cannot use the app until you extend access again.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Revoke now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
