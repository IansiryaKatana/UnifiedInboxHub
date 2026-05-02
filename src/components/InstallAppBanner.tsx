import { useCallback, useEffect, useState } from "react";
import { X, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "pwa_install_banner_dismissed";

function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  // iOS Safari home-screen Web App
  // @ts-expect-error - non-standard
  if (window.navigator.standalone === true) return true;
  return false;
}

function isLikelyMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Banner for installing the PWA on phones (Chrome uses beforeinstallprompt; iOS has no system prompt). */
export function InstallAppBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext && window.location.hostname !== "localhost") return;
    if (isStandalonePwa()) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    if (isLikelyMobile()) setVisible(true);

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const runInstall = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* user dismissed native prompt */
    }
    dismiss();
  };

  if (dismissed || !visible || isStandalonePwa()) return null;

  const showChromeInstall = Boolean(deferred);

  return (
    <div
      className={cn(
        "shrink-0 border-b border-border bg-muted/60 backdrop-blur-sm px-3 py-2.5 md:px-4",
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
      )}
      role="region"
      aria-label="Install app"
    >
      <div className="flex gap-2 min-w-0 items-start">
        {isIOS() ? (
          <Share2 className="size-5 shrink-0 text-primary mt-0.5" aria-hidden />
        ) : (
          <Download className="size-5 shrink-0 text-primary mt-0.5" aria-hidden />
        )}
        <div className="min-w-0 text-sm leading-snug">
          <p className="font-medium text-foreground">Install Unified Inbox Hub</p>
          {showChromeInstall ? (
            <p className="text-muted-foreground text-xs mt-0.5">Add to your home screen for quicker access and notifications.</p>
          ) : isIOS() ? (
            <p className="text-muted-foreground text-xs mt-0.5">
              Tap <strong className="text-foreground">Share</strong>
              {" "}
              <span className="inline-flex align-middle opacity-80">□↑</span>
              {" "}
              then <strong className="text-foreground">Add to Home Screen</strong>.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs mt-0.5">
              Open your browser menu (<strong className="text-foreground">⋮</strong>
              {" "}
              or <strong className="text-foreground">⋮</strong> in the URL bar) and choose{" "}
              <strong className="text-foreground">Install app</strong>
              {" "}
              or <strong className="text-foreground">Add to Home screen</strong>.
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        {showChromeInstall && (
          <Button type="button" size="sm" onClick={() => void runInstall()} className="gap-1.5">
            <Download className="size-4" />
            Install
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={dismiss} aria-label="Dismiss">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
