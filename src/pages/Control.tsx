import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ControlLogin } from "./control/ControlLogin";
import { ControlDashboard } from "./control/ControlDashboard";

export default function Control() {
  const { session, loading: authLoading, isAdmin, accessLoading, signOut } = useAuth();

  useEffect(() => {
    document.title = "Control — Unified Inbox Hub";
  }, []);

  if (authLoading || accessLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-neutral-950 text-neutral-400">
        <Loader2 className="size-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (!session || !isAdmin) {
    return <ControlLogin wrongAccount={Boolean(session && !isAdmin)} onSignOut={signOut} />;
  }

  return <ControlDashboard onSignOut={signOut} />;
}
