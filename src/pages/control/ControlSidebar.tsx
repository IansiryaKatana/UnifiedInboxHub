import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
import { ShieldCheck, Users, UserPlus, Inbox, LogOut, Menu, Loader2 } from "lucide-react";

type Props = {
  onCreateUser: () => void;
  onSignOut: () => Promise<void>;
  signingOut: boolean;
};

function SidebarInner({ onCreateUser, onSignOut, signingOut }: Props) {
  return (
    <div className="flex h-full w-64 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4">
        <div className="size-9 shrink-0 rounded-lg bg-neutral-900 grid place-items-center">
          <ShieldCheck className="size-4 text-neutral-100" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Unified Inbox Hub</p>
          <p className="truncate text-sm font-semibold">Control</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3">
        <div
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
            "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
        >
          <Users className="size-4 shrink-0" />
          User access
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 w-full justify-start gap-2 border-sidebar-border bg-transparent"
          onClick={onCreateUser}
        >
          <UserPlus className="size-4" />
          Create user
        </Button>
      </nav>

      <div className="mt-auto space-y-1 border-t border-sidebar-border p-3">
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2" asChild>
          <Link to="/">
            <Inbox className="size-4" />
            Open inbox
          </Link>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground">
              {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              Sign out
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of control?</AlertDialogTitle>
              <AlertDialogDescription>You will need to sign in again to manage users.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onSignOut}>Sign out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function ControlSidebar(props: Props) {
  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            className="md:hidden fixed top-3 left-3 z-40 size-10 rounded-lg border border-border bg-background shadow-sm grid place-items-center"
            aria-label="Open control menu"
          >
            <Menu className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 max-w-[85vw] p-0">
          <SidebarInner {...props} />
        </SheetContent>
      </Sheet>

      <aside className="hidden md:flex h-full shrink-0">
        <SidebarInner {...props} />
      </aside>
    </>
  );
}
