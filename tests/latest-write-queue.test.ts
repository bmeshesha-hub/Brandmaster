import assert from "node:assert/strict";
import test from "node:test";
import { createLatestWriteQueue } from "../lib/latest-write-queue";

test("keeps only the latest pending value while a write is active", async () => {
  const written: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = createLatestWriteQueue<number>(async (value) => {
    written.push(value);
    if (value === 1) await firstWrite;
  });

  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);
  releaseFirst?.();
  await queue.whenIdle();

  assert.deepEqual(written, [1, 3]);
});

test("continues with the latest value after a failed write", async () => {
  const written: number[] = [];
  const errors: unknown[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = createLatestWriteQueue<number>(async (value) => {
    written.push(value);
    if (value === 1) {
      await firstWrite;
      throw new Error("write failed");
    }
  }, (error) => errors.push(error));

  queue.enqueue(1);
  queue.enqueue(2);
  releaseFirst?.();
  await queue.whenIdle();

  assert.deepEqual(written, [1, 2]);
  assert.equal(errors.length, 1);
});
