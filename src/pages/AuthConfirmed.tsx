import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Status = "working" | "success" | "error" | "hint";

export default function AuthConfirmed() {
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Email confirmed — Unified Inbox Hub";
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }

      if (session?.user) {
        setStatus("success");
        setMessage(null);
        return;
      }

      const hash = window.location.hash.replace(/^#/, "");
      const searchParams = new URLSearchParams(window.location.search);
      const hasAuthFragment =
        hash.includes("access_token") || hash.includes("type=signup") || searchParams.has("code");

      if (hasAuthFragment) {
        await new Promise((r) => setTimeout(r, 500));
        const retry = await supabase.auth.getSession();
        if (cancelled) return;
        if (retry.data.session?.user) {
          setStatus("success");
          return;
        }
        setStatus("error");
        setMessage(
          "We could not confirm your email from this link. It may have expired. Try signing up again or sign in if you already confirmed.",
        );
        return;
      }

      setStatus("hint");
      setMessage(
        "Open the confirmation link from your email to verify your account. If you already confirmed, sign in below.",
      );
    };

    void run();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_IN" && session?.user) {
        setStatus("success");
        setMessage(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

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

        <Card className="p-6 shadow-lg text-center space-y-4">
          {status === "working" && (
            <>
              <Loader2 className="size-10 animate-spin mx-auto text-muted-foreground" aria-label="Confirming" />
              <h2 className="text-lg font-medium">Confirming your email…</h2>
              <p className="text-sm text-muted-foreground">Please wait a moment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="size-12 mx-auto text-green-600 dark:text-green-500" aria-hidden />
              <h2 className="text-lg font-medium">Email confirmed</h2>
              <p className="text-sm text-muted-foreground">
                Your account is verified. You can open the app and start using Unified Inbox Hub.
              </p>
              <Button className="w-full" asChild>
                <Link to="/">Continue to app</Link>
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="size-12 mx-auto text-destructive" aria-hidden />
              <h2 className="text-lg font-medium">Could not confirm</h2>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button className="w-full" variant="outline" asChild>
                <Link to="/auth">Back to sign in</Link>
              </Button>
            </>
          )}

          {status === "hint" && (
            <>
              <h2 className="text-lg font-medium">Confirm your email</h2>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button className="w-full" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
