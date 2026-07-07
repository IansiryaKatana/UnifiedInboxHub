import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  accessLoading: boolean;
  isAdmin: boolean;
  accessExpiresAt: string | null;
  hasActiveAccess: boolean;
  accessBlockedReason: string | null;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accessExpiresAt, setAccessExpiresAt] = useState<string | null>(null);
  const [hasActiveAccess, setHasActiveAccess] = useState(false);
  const [accessBlockedReason, setAccessBlockedReason] = useState<string | null>(null);

  const loadAccess = useCallback(async (userId: string) => {
    setAccessLoading(true);
    try {
      const [{ data: adminRole }, { data: active }, { data: profile }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        supabase.rpc("user_has_active_access", { _user_id: userId }),
        supabase.from("profiles").select("access_expires_at").eq("id", userId).maybeSingle(),
      ]);

      const admin = Boolean(adminRole);
      const activeAccess = Boolean(active);
      setIsAdmin(admin);
      setAccessExpiresAt(profile?.access_expires_at ?? null);
      setHasActiveAccess(activeAccess);

      if (!activeAccess && !admin) {
        const reason = "Your access has expired. Contact your administrator.";
        sessionStorage.setItem("auth-blocked-reason", reason);
        setAccessBlockedReason(reason);
        await supabase.auth.signOut();
        setSession(null);
      } else {
        setAccessBlockedReason(null);
      }
    } finally {
      setAccessLoading(false);
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
      if (s?.user?.id) {
        void loadAccess(s.user.id);
      } else {
        setIsAdmin(false);
        setAccessExpiresAt(null);
        setHasActiveAccess(false);
        setAccessBlockedReason(null);
        setAccessLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
      if (s?.user?.id) void loadAccess(s.user.id);
    });
    return () => subscription.unsubscribe();
  }, [loadAccess]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setAccessBlockedReason(null);
  };

  const refreshAccess = useCallback(async () => {
    if (!session?.user?.id) return;
    await loadAccess(session.user.id);
  }, [loadAccess, session?.user?.id]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        accessLoading,
        isAdmin,
        accessExpiresAt,
        hasActiveAccess,
        accessBlockedReason,
        signOut,
        refreshAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
