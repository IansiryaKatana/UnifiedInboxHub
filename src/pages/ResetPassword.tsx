import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Phase = "request" | "update" | "sent" | "invalid";

function hashHasRecoveryType(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return params.get("type") === "recovery";
}

function searchHasRecoveryType(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("type") === "recovery" || Boolean(params.get("code"));
}

function hasRecoveryIntent(): boolean {
  return hashHasRecoveryType() || searchHasRecoveryType();
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(() => (hasRecoveryIntent() ? "update" : "request"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    document.title = "Reset password — Unified Inbox Hub";
  }, []);

  useEffect(() => {
    if (hasRecoveryIntent()) {
      setPhase("update");
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setPhase("update");
      }
    });

    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setPhase("invalid");
          toast.error("This reset link is invalid or expired. Request a new link.");
          setAuthChecked(true);
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (hasRecoveryIntent()) {
        if (session) {
          setPhase("update");
        } else {
          setPhase("invalid");
        }
      }

      setAuthChecked(true);
    })();

    return () => subscription.unsubscribe();
  }, []);

  const redirectBase = () => `${window.location.origin}/auth/reset-password`;

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectBase(),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPhase("sent");
    toast.success("If an account exists for that email, you will receive a reset link shortly.");
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      toast.error("This reset session is no longer valid. Request a new reset link.");
      setPhase("invalid");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Your password has been updated.");
    navigate("/", { replace: true });
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-soft via-background to-background p-4">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-soft via-background to-background p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <img
            src="/pwa-192.png"
            alt=""
            width={40}
            height={40}
            className="size-10 rounded-xl object-cover shrink-0"
            decoding="async"
            aria-hidden
          />
          <h1 className="text-2xl font-semibold tracking-tight">Unified Inbox Hub</h1>
        </div>

        <Card className="p-6 shadow-lg">
          {phase === "request" && (
            <form onSubmit={handleRequest} className="space-y-4">
              <h2 className="text-lg font-medium">Reset password</h2>
              <p className="text-sm text-muted-foreground">
                Enter your email address and we will send you a link to choose a new password.
              </p>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
                Send reset link
              </Button>
            </form>
          )}

          {phase === "sent" && (
            <div className="space-y-4 text-center">
              <h2 className="text-lg font-medium">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{email}</span>, you will receive a
                message with a link to reset your password.
              </p>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/auth">Back to sign in</Link>
              </Button>
            </div>
          )}

          {phase === "update" && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <h2 className="text-lg font-medium">Choose a new password</h2>
              <p className="text-sm text-muted-foreground">Enter and confirm your new password below.</p>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
                Update password
              </Button>
            </form>
          )}

          {phase === "invalid" && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Reset link expired or invalid</h2>
              <p className="text-sm text-muted-foreground">
                This reset link is no longer valid. Request a new link and use the latest email message.
              </p>
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  setPhase("request");
                  void navigate("/auth/reset-password", { replace: true });
                }}
              >
                Request a new reset link
              </Button>
            </div>
          )}

        </Card>

        <p className="text-center mt-6">
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-md border border-border/70 bg-muted/50 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
