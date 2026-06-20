import { useCallback, useEffect, useState } from "react";

const DISMISS_KEY = "pwa_install_banner_dismissed";

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  // @ts-expect-error - iOS Safari home-screen Web App
  if (window.navigator.standalone === true) return true;
  return false;
}

export function isLikelyMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext && window.location.hostname !== "localhost") return;
    if (isStandalonePwa()) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setEligible(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    setEligible(true);

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const runInstall = useCallback(async () => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") dismiss();
      return outcome === "accepted";
    } catch {
      return false;
    }
  }, [deferred, dismiss]);

  const showInstall = eligible && !dismissed && !isStandalonePwa();
  const canPromptInstall = Boolean(deferred);

  return {
    showInstall,
    canPromptInstall,
    isIOS: isIOS(),
    isMobile: isLikelyMobile(),
    runInstall,
    dismiss,
  };
}
