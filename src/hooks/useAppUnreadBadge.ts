import { useEffect } from "react";

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Updates the PWA / installed app icon unread badge (Chromium).
 */
export function useAppUnreadBadge(unreadThreadCount: number) {
  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (typeof nav.clearAppBadge !== "function" && typeof nav.setAppBadge !== "function") return;

    void (async () => {
      try {
        const n = Math.min(Math.max(0, unreadThreadCount), 99);
        if (n > 0 && typeof nav.setAppBadge === "function") {
          await nav.setAppBadge(n);
        } else if (typeof nav.clearAppBadge === "function") {
          await nav.clearAppBadge();
        }
      } catch {
        /* unsupported or denied */
      }
    })();
  }, [unreadThreadCount]);
}
