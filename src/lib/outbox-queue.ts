import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "unified-inbox-outbox-v1";
const MAX_ITEMS = 40;

export type OutboxSendItem = {
  id: string;
  createdAt: string;
  fnName: "gmail-send" | "smtp-send";
  body: Record<string, unknown>;
};

function emitOutboxChanged() {
  try {
    window.dispatchEvent(new Event("outbox-changed"));
  } catch {
    /* ignore */
  }
}

function readRaw(): OutboxSendItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) =>
        x &&
        typeof x === "object" &&
        typeof (x as OutboxSendItem).id === "string" &&
        typeof (x as OutboxSendItem).fnName === "string" &&
        typeof (x as OutboxSendItem).body === "object",
    ) as OutboxSendItem[];
  } catch {
    return [];
  }
}

function writeRaw(items: OutboxSendItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  emitOutboxChanged();
}

export function getOutbox(): OutboxSendItem[] {
  return readRaw();
}

export function enqueueOutboxSend(item: Omit<OutboxSendItem, "id" | "createdAt">): void {
  const next: OutboxSendItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const all = readRaw();
  all.push(next);
  const trimmed = all.slice(-MAX_ITEMS);
  writeRaw(trimmed);
}

export function removeOutboxItem(id: string): void {
  writeRaw(readRaw().filter((x) => x.id !== id));
}

/** Network / offline failures only — not auth or SMTP misconfiguration. */
export function shouldQueueSendFailure(params: {
  error: unknown;
  responseCode?: string;
}): boolean {
  const code = params.responseCode;
  if (code === "RECONNECT_GMAIL" || code === "CHECK_SMTP") return false;

  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;

  const msg = params.error instanceof Error ? params.error.message : String(params.error);
  if (/failed to fetch|networkerror|load failed|network request failed|offline/i.test(msg)) return true;
  return false;
}

export async function flushOutbox(supabase: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const items = readRaw();
  if (items.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const remaining: OutboxSendItem[] = [];

  for (const item of items) {
    try {
      const { data, error } = await supabase.functions.invoke(item.fnName, { body: item.body });
      const res = data as { ok?: boolean; error?: string; code?: string } | null;
      if (error && !res) {
        remaining.push(item);
        failed++;
        continue;
      }
      if (res?.ok === true) {
        sent++;
        continue;
      }
      remaining.push(item);
      failed++;
    } catch {
      remaining.push(item);
      failed++;
    }
  }

  writeRaw(remaining);
  return { sent, failed };
}
