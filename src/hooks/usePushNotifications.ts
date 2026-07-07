import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const PUSH_OPT_OUT_KEY = "push-notifications-opt-out";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isPushOptedOut(): boolean {
  try {
    return localStorage.getItem(PUSH_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function setPushOptOut(optOut: boolean) {
  try {
    if (optOut) localStorage.setItem(PUSH_OPT_OUT_KEY, "1");
    else localStorage.removeItem(PUSH_OPT_OUT_KEY);
  } catch {
    /* ignore */
  }
}

export function usePushNotifications(userId: string | undefined) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoAttemptedRef = useRef(false);

  const vapidPublic = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window &&
        Boolean(vapidPublic),
    );
  }, [vapidPublic]);

  const registerSubscription = useCallback(
    async (sub: PushSubscription) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const { error } = await supabase.functions.invoke("push-subscribe", {
        body: { subscription: sub.toJSON() },
      });
      if (error) throw new Error(error.message);
      setEnabled(true);
    },
    [],
  );

  const subscribe = useCallback(async () => {
    if (!vapidPublic) throw new Error("VAPID public key not configured");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Notification permission denied");
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic),
      });
    }
    await registerSubscription(sub);
    setPushOptOut(false);
  }, [vapidPublic, registerSubscription]);

  const unsubscribe = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const endpoint = sub?.endpoint;
    if (sub) await sub.unsubscribe();

    if (endpoint) {
      const { error } = await supabase.functions.invoke("push-subscribe", {
        body: { remove: true, endpoint },
      });
      if (error) console.warn("push-subscribe remove:", error.message);
    }
    setPushOptOut(true);
    setEnabled(false);
  }, []);

  const setNotificationsOn = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        if (on) await subscribe();
        else await unsubscribe();
      } finally {
        setBusy(false);
      }
    },
    [subscribe, unsubscribe],
  );

  /** On sign-in: enable push by default unless the user previously opted out. */
  useEffect(() => {
    if (!userId || !supported || !vapidPublic || isPushOptedOut()) return;
    if (autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await registerSubscription(existing);
          if (!cancelled) setEnabled(true);
          return;
        }
        await subscribe();
      } catch (e) {
        console.warn("auto push subscribe:", e);
        if (!cancelled) setEnabled(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, supported, vapidPublic, subscribe, registerSubscription]);

  useEffect(() => {
    if (!userId) {
      autoAttemptedRef.current = false;
      setEnabled(false);
    }
  }, [userId]);

  return { supported, enabled, busy, setNotificationsOn, vapidConfigured: Boolean(vapidPublic) };
}
