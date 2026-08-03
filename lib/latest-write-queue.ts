export type LatestWriteQueue<T> = {
  enqueue: (value: T) => void;
  whenIdle: () => Promise<void>;
};

/**
 * Runs one asynchronous write at a time and retains only the newest value
 * received while that write is in progress.
 */
export function createLatestWriteQueue<T>(
  write: (value: T) => Promise<void>,
  onError: (error: unknown) => void = () => undefined,
): LatestWriteQueue<T> {
  let pending: T | undefined;
  let hasPending = false;
  let active: Promise<void> | null = null;

  const drain = async () => {
    while (hasPending) {
      const next = pending as T;
      pending = undefined;
      hasPending = false;
      try {
        await write(next);
      } catch (error) {
        try { onError(error); } catch { /* Error reporting must not stop later writes. */ }
      }
    }
  };

  const start = () => {
    if (active || !hasPending) return;
    active = drain().finally(() => {
      active = null;
      start();
    });
  };

  return {
    enqueue(value) {
      pending = value;
      hasPending = true;
      start();
    },
    async whenIdle() {
      while (active || hasPending) {
        if (!active) start();
        if (active) await active;
      }
    },
  };
}
