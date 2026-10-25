import type { PhraseAudio } from './audio-cache';
import type { LocalModel } from './engine';
import { MODEL_IDENTITY } from './kokoro-assets';

// A load fails after this long without progress, so slow but steady downloads can finish.
// It also covers the ~22 MB runtime download and model start, which report no progress.
const LOAD_IDLE_MS = 120000;

// Terminating the worker cancels both download fetches and stalled WASM inference.
export class KokoroModel implements LocalModel {
  readonly identity = MODEL_IDENTITY;
  private worker: Worker | null = null;
  private nextId = 0;
  private ready = false;
  private rejectJob: ((reason: Error) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finishLoad: (() => void) | null = null;
  private progress: ((fraction: number) => void) | null = null;
  private finishAudio: ((audio: PhraseAudio) => void) | null = null;
  private activeId = 0;
  load(signal: AbortSignal, progress: (fraction: number) => void): Promise<void> {
    this.dispose();
    if (signal.aborted) return Promise.reject(new Error('Cancelled'));
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return Promise.reject(new Error('Browser unsupported'));
    return new Promise((resolve, reject) => {
      const abort = () => this.dispose();
      signal.addEventListener('abort', abort, { once: true });
      this.finishLoad = () => { signal.removeEventListener('abort', abort); resolve(); };
      this.rejectJob = error => { signal.removeEventListener('abort', abort); reject(error); };
      this.progress = progress;
      try {
        this.worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => this.receive(event.data);
        this.worker.onerror = () => this.dispose();
        this.restartLoadTimer();
        this.worker.postMessage({ kind: 'load' });
      } catch { this.dispose(); }
    });
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private restartLoadTimer(): void { this.clearTimer(); this.timer = setTimeout(() => this.dispose(), LOAD_IDLE_MS); }
  private receive(data: unknown): void {
    if (!data || typeof data !== 'object' || !('kind' in data)) return;
    if (data.kind === 'progress' && 'fraction' in data && typeof data.fraction === 'number' && Number.isFinite(data.fraction)) {
      if (this.finishLoad) this.restartLoadTimer();
      this.progress?.(Math.max(0, Math.min(1, data.fraction))); return;
    }
    if (data.kind === 'ready') {
      this.clearTimer(); this.ready = true; this.rejectJob = null; this.progress?.(1); this.progress = null;
      this.finishLoad?.(); this.finishLoad = null; return;
    }
    if (data.kind === 'audio' && 'id' in data && data.id === this.activeId && 'samples' in data && data.samples instanceof Float32Array && 'sampleRate' in data && data.sampleRate === 24000 && data.samples.length > 0 && data.samples.length <= 24000 * 30 && data.samples.every(Number.isFinite)) {
      this.clearTimer(); this.rejectJob = null;
      this.finishAudio?.({ samples: data.samples, sampleRate: data.sampleRate }); this.finishAudio = null; return;
    }
    if ((data.kind === 'audio' || data.kind === 'error') && 'id' in data && data.id === this.activeId && this.finishAudio) {
      // A failed or over-long phrase rejects only its job. The worker stays loaded for the next phrase.
      this.clearTimer(); this.finishAudio = null;
      this.rejectJob?.(new Error('Phrase generation failed')); this.rejectJob = null; return;
    }
    this.dispose();
  }
  get available(): boolean { return this.ready; }
  generate(text: string, rate: number): Promise<PhraseAudio> {
    if (!this.ready || !this.worker || this.rejectJob) return Promise.reject(new Error('Model unavailable'));
    return new Promise((resolve, reject) => {
      this.activeId = ++this.nextId;
      this.finishAudio = resolve; this.rejectJob = reject;
      // Inference still running after 30 s holds the single-threaded worker, so stop it. The voice must then load again.
      this.timer = setTimeout(() => this.dispose(), 30000);
      this.worker?.postMessage({ kind: 'generate', id: this.activeId, text, rate });
    });
  }
  dispose(): void {
    this.clearTimer(); this.worker?.terminate(); this.worker = null; this.ready = false;
    this.rejectJob?.(new Error('Speech worker stopped')); this.rejectJob = null;
    this.finishLoad = null; this.finishAudio = null; this.progress = null;
  }
}
