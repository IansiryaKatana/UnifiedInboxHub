/** Blocks foreground/cron-triggered sync while Add Account (or similar) runs initial sync. */
let pauseDepth = 0;

export function isMailboxSyncPaused(): boolean {
  return pauseDepth > 0;
}

export async function withMailboxSyncPaused<T>(fn: () => Promise<T>): Promise<T> {
  pauseDepth += 1;
  try {
    return await fn();
  } finally {
    pauseDepth = Math.max(0, pauseDepth - 1);
  }
}
