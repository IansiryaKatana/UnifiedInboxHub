/** Ensures only one imap-sync edge call runs per account at a time (avoids 546 storms). */
const chains = new Map<string, Promise<void>>();

export async function withImapSyncMutex<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const prior = chains.get(accountId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prior.then(() => gate);
  chains.set(accountId, queued);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(accountId) === queued) chains.delete(accountId);
  }
}
