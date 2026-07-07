import { useState, useEffect } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const BLOCKED_REASON_KEY = "auth-blocked-reason";

export default function Auth() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.title = "Sign in — Unified Inbox Hub";
    const blocked = sessionStorage.getItem(BLOCKED_REASON_KEY);
    if (blocked) {
      toast.error(blocked);
      sessionStorage.removeItem(BLOCKED_REASON_KEY);
    }
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-soft via-background to-background p-4">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  if (session) return <Navigate to="/" replace />;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      setLoading(false);
      const msg =
        error.message.toLowerCase().includes("invalid login credentials")
          ? "Incorrect email or password."
          : error.message;
      toast.error(msg);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const [{ data: active }, { data: adminRole }] = await Promise.all([
        supabase.rpc("user_has_active_access", { _user_id: user.id }),
        supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      ]);
      if (!active && !adminRole) {
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("Your access has expired. Contact your administrator.");
        return;
      }
    }

    setLoading(false);
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-soft via-background to-background px-4 py-8 sm:px-6">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <img
            src="/pwa-192.png"
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-2xl object-cover shadow-sm ring-1 ring-border/60"
            decoding="async"
            aria-hidden
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Unified Inbox Hub</h1>
            <p className="mt-1 text-sm text-muted-foreground">All your inboxes in one place</p>
          </div>
        </div>

        <Card className="border-border/80 bg-card/95 p-6 shadow-lg backdrop-blur-sm sm:p-8">
          <div className="mb-6 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">Enter your email and password to continue.</p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="signin-password">Password</Label>
                <Link
                  to="/auth/reset-password"
                  className="text-xs font-medium text-primary hover:underline underline-offset-2 shrink-0"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="signin-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={loading}>
              {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground px-2">
          By signing in, you agree to our{" "}
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

export { BLOCKED_REASON_KEY };
