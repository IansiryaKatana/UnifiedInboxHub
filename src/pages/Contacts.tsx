import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { InboxAppLayout } from "@/components/inbox/InboxAppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
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

type ContactRow = {
  id: string;
  email: string;
  display_name: string | null;
  company: string | null;
  notes: string | null;
  updated_at: string;
};

const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function Contacts() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [form, setForm] = useState({ email: "", display_name: "", company: "", notes: "" });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("contacts")
      .select("id, email, display_name, company, notes, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ContactRow[]);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    document.title = "Contacts — Unified Inbox Hub";
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ email: "", display_name: "", company: "", notes: "" });
    setSheetOpen(true);
  };

  const openEdit = (c: ContactRow) => {
    setEditing(c);
    setForm({
      email: c.email,
      display_name: c.display_name ?? "",
      company: c.company ?? "",
      notes: c.notes ?? "",
    });
    setSheetOpen(true);
  };

  const save = async () => {
    if (!user?.id) return;
    const em = form.email.trim().toLowerCase();
    if (!emailOk(em)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setSaving(true);
    try {
      if (editing?.id) {
        const { error } = await supabase
          .from("contacts")
          .update({
            email: em,
            display_name: form.display_name.trim() || null,
            company: form.company.trim() || null,
            notes: form.notes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editing.id)
          .eq("user_id", user.id);
        if (error) throw new Error(error.message);
        toast.success("Contact updated");
      } else {
        const { error } = await supabase.from("contacts").insert({
          user_id: user.id,
          email: em,
          display_name: form.display_name.trim() || null,
          company: form.company.trim() || null,
          notes: form.notes.trim() || null,
        });
        if (error) throw new Error(error.message);
        toast.success("Contact added");
      }
      setSheetOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save contact");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!user?.id || !deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("contacts").delete().eq("id", deleteId).eq("user_id", user.id);
      if (error) throw new Error(error.message);
      toast.success("Contact removed");
      setDeleteId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <InboxAppLayout contactsActive>
      <header className="border-b border-border px-4 md:px-6 py-3 md:py-4 flex items-start justify-between gap-3 shrink-0 max-md:pl-14">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Saved addresses for compose and reference.</p>
        </div>
        <Button type="button" size="sm" className="gap-1.5 shrink-0" onClick={openNew}>
          <Plus className="size-4" /> Add
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6">
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading contacts…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contacts yet. Add one to use in compose suggestions.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((c) => (
              <Card key={c.id} className="overflow-hidden flex flex-col">
                <CardHeader className="py-3 px-4 space-y-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.display_name || c.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => openEdit(c)} aria-label="Edit contact">
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setDeleteId(c.id)} aria-label="Delete contact">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {(c.company || c.notes) && (
                  <CardContent className="pt-0 px-4 pb-3 text-xs text-muted-foreground space-y-1">
                    {c.company ? <p>{c.company}</p> : null}
                    {c.notes ? <p className="line-clamp-3">{c.notes}</p> : null}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side={isMobile ? "bottom" : "right"} className={isMobile ? "rounded-t-2xl p-0 gap-0 max-h-[92vh]" : "sm:max-w-md p-0 gap-0"}>
          <SheetHeader className="px-4 py-3 border-b border-border flex flex-row items-center justify-between space-y-0">
            <SheetTitle>{editing ? "Edit contact" : "New contact"}</SheetTitle>
            <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden" onClick={() => setSheetOpen(false)} aria-label="Close">
              <X className="size-4" />
            </button>
          </SheetHeader>
          <div className="px-4 py-4 space-y-3 overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Display name</Label>
              <Input id="c-name" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-co">Company</Label>
              <Input id="c-co" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea id="c-notes" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="border-t border-border px-4 py-3 flex justify-end gap-2 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && !deleting && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>This removes the saved entry from your contact book only.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              className="gap-2 sm:ml-0"
              onClick={() => void remove()}
            >
              {deleting ? "Removing…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </InboxAppLayout>
  );
}
