import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KokoroModel } from "../src/speech/kokoro-model";

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function startLoad() {
  const loading = new KokoroModel().load(
    new AbortController().signal,
    () => {},
  );
  return {
    worker: FakeWorker.last,
    outcome: loading.then(
      () => "ready",
      (error: Error) => error.message,
    ),
  };
}

it("keeps loading while a slow download makes steady progress", async () => {
  const { worker, outcome } = startLoad();
  // About 3 Mbit/s: the 93 MB model takes about 250 seconds.
  for (let second = 1; second <= 250; second++) {
    await vi.advanceTimersByTimeAsync(1000);
    worker.emit({ kind: "progress", fraction: Math.min(0.98, second / 250) });
  }
  worker.emit({ kind: "ready" });
  expect(await outcome).toBe("ready");
  expect(worker.terminated).toBe(false);
});

it("stops a load that makes no progress for two minutes", async () => {
  const { worker, outcome } = startLoad();
  await vi.advanceTimersByTimeAsync(30000);
  worker.emit({ kind: "progress", fraction: 0.1 });
  await vi.advanceTimersByTimeAsync(119999);
  expect(worker.terminated).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(worker.terminated).toBe(true);
  expect(await outcome).toBe("Speech worker stopped");
});
