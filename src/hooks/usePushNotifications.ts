import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

export function usePushNotifications(userId: string | undefined) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    if (!userId || !supported || !vapidPublic) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setEnabled(!!sub);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, supported, vapidPublic]);

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
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Not signed in");

    const { error } = await supabase.functions.invoke("push-subscribe", {
      body: { subscription: sub.toJSON() },
    });
    if (error) throw new Error(error.message);
    setEnabled(true);
  }, [vapidPublic]);

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

  return { supported, enabled, busy, setNotificationsOn, vapidConfigured: Boolean(vapidPublic) };
}
