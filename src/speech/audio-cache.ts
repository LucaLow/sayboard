export type PhraseAudio = { samples: Float32Array; sampleRate: number };

// Audio and text stay in memory only. Reloading the page clears both.
// 12 MiB holds 32 prepared phrases of about four seconds of 24 kHz audio each.
export class PhraseAudioCache {
  private entries = new Map<string, PhraseAudio>();
  private bytes = 0;
  constructor(private maxBytes = 12 * 1024 * 1024, private maxEntries = 32) {}
  get(key: string): PhraseAudio | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: PhraseAudio): void {
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.samples.byteLength;
    this.entries.delete(key);
    if (value.samples.byteLength > this.maxBytes) return;
    this.entries.set(key, value);
    this.bytes += value.samples.byteLength;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].samples.byteLength;
    }
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
  get byteLength(): number { return this.bytes; }
}
