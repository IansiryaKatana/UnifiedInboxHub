import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Eye, EyeOff, ShieldCheck, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type Props = {
  /** Signed in, but not an administrator */
  wrongAccount?: boolean;
  onSignOut: () => Promise<void>;
};

export function ControlLogin({ wrongAccount, onSignOut }: Props) {
  const { refreshAccess } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
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
      const { data: adminRole } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!adminRole) {
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("This account does not have administrator access.");
        return;
      }
    }

    await refreshAccess();
    setLoading(false);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await onSignOut();
    setSigningOut(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 px-4 py-8 sm:px-6">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <div className="size-12 rounded-2xl bg-neutral-800 ring-1 ring-neutral-700 grid place-items-center">
            <ShieldCheck className="size-6 text-neutral-100" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Unified Inbox Hub</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-50 sm:text-2xl">Control panel</h1>
            <p className="mt-1 text-sm text-neutral-400">Administrator sign-in only</p>
          </div>
        </div>

        {wrongAccount ? (
          <Card className="border-neutral-800 bg-neutral-900/90 p-6 text-neutral-100 shadow-xl sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight">Access denied</h2>
            <p className="mt-2 text-sm text-neutral-400">
              The signed-in account is not an administrator. Sign out and use an admin account to continue.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-6 w-full h-11 border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-800 hover:text-neutral-50"
              disabled={signingOut}
              onClick={handleSignOut}
            >
              {signingOut ? <Loader2 className="size-4 mr-2 animate-spin" /> : <LogOut className="size-4 mr-2" />}
              Sign out and try again
            </Button>
          </Card>
        ) : (
          <Card className="border-neutral-800 bg-neutral-900/90 p-6 text-neutral-100 shadow-xl sm:p-8">
            <div className="mb-6 space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
              <p className="text-sm text-neutral-400">Manage user accounts and access from here.</p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="control-email" className="text-neutral-200">
                  Admin email
                </Label>
                <Input
                  id="control-email"
                  type="email"
                  required
                  autoComplete="username"
                  autoFocus
                  placeholder="admin@unifiedinboxhub.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 border-neutral-700 bg-neutral-950 text-neutral-50 placeholder:text-neutral-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="control-password" className="text-neutral-200">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="control-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Enter admin password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 border-neutral-700 bg-neutral-950 pr-11 text-neutral-50 placeholder:text-neutral-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-neutral-500 transition-colors hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="h-11 w-full bg-neutral-100 text-neutral-950 hover:bg-white"
                disabled={loading}
              >
                {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Sign in to control
              </Button>
            </form>
          </Card>
        )}

        <p className="mt-6 text-center text-xs text-neutral-500">
          Looking for your inbox?{" "}
          <Link to="/auth" className="text-neutral-300 underline underline-offset-2 hover:text-neutral-100">
            User sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
