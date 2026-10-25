import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KokoroModel } from "../src/speech/kokoro-model";

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: { kind: string; id?: number }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: { kind: string; id?: number }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
  get lastId() {
    return this.posted.at(-1)?.id;
  }
}
const clip = (seconds: number) => ({
  kind: "audio",
  samples: new Float32Array(24000 * seconds).fill(0.01),
  sampleRate: 24000,
});
beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function loaded() {
  const model = new KokoroModel();
  const loading = model.load(new AbortController().signal, () => {});
  const worker = FakeWorker.last;
  worker.emit({ kind: "ready" });
  await loading;
  return { model, worker };
}

it("rejects only the failed phrase and keeps the worker for the next one", async () => {
  const { model, worker } = await loaded();
  const failed = model.generate("Help", 1);
  worker.emit({ kind: "error", id: worker.lastId });
  await expect(failed).rejects.toThrow("Phrase generation failed");
  expect(worker.terminated).toBe(false);
  expect(model.available).toBe(true);
  const next = model.generate("Yes", 1);
  worker.emit({ ...clip(1), id: worker.lastId });
  await expect(next).resolves.toMatchObject({ sampleRate: 24000 });
});

it("rejects an over-long clip without stopping the worker", async () => {
  const { model, worker } = await loaded();
  const long = model.generate("A long typed message", 0.5);
  worker.emit({ ...clip(31), id: worker.lastId });
  await expect(long).rejects.toThrow("Phrase generation failed");
  expect(worker.terminated).toBe(false);
  const next = model.generate("Yes", 1);
  worker.emit({ ...clip(1), id: worker.lastId });
  await expect(next).resolves.toMatchObject({ sampleRate: 24000 });
});

it("stops a worker still generating after 30 seconds", async () => {
  vi.useFakeTimers();
  const { model, worker } = await loaded();
  const stalled = model.generate("Help", 1);
  const outcome = stalled.catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(30000);
  expect(await outcome).toBe("Speech worker stopped");
  expect(worker.terminated).toBe(true);
  expect(model.available).toBe(false);
  await expect(model.generate("Yes", 1)).rejects.toThrow("Model unavailable");
});
