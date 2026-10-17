import { chooseLocalVoice } from '../voices';
import type { PhraseAudio } from './audio-cache';
import type { SpeakOptions, SpeechOutput } from './engine';

export class BrowserSpeechOutput implements SpeechOutput {
  private context: AudioContext | null = null;
  private resume: Promise<void> = Promise.resolve();
  private generation = 0;
  private source: AudioBufferSourceNode | null = null;
  private finish: (() => void) | null = null;
  unlock(): boolean {
    this.context ??= new AudioContext();
    this.resume = this.context.resume();
    void this.resume.catch(() => {});
    return this.context.state === 'running';
  }
  system(text: string, options: SpeakOptions): void {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      options.onError?.('Device speech is unavailable in this browser. The selected words can still be shown.'); return;
    }
    // Some devices populate voices after startup without a voiceschanged event.
    // Resolve again in the tap handler, keeping speech inside the user gesture.
    const voice = chooseLocalVoice(window.speechSynthesis.getVoices(), options.systemVoiceURI ?? '');
    if (!voice) {
      options.onError?.('No on-device voice is ready. The selected words can still be shown.'); return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice; utterance.rate = options.rate ?? 1;
    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = () => options.onError?.('Speech could not play. Check device volume or try another on-device voice.');
    try { window.speechSynthesis.speak(utterance); } catch { options.onError?.('Speech could not start.'); }
  }
  async play(audio: PhraseAudio, options: SpeakOptions): Promise<void> {
    const token = this.generation;
    await this.resume;
    if (token !== this.generation) return;
    if (!this.context || this.context.state !== 'running') throw new Error('Audio permission unavailable');
    const buffer = this.context.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.samples);
    const source = this.context.createBufferSource(); source.buffer = buffer;
    source.connect(this.context.destination); this.source = source;
    await new Promise<void>((resolve, reject) => {
      this.finish = resolve;
      source.onended = () => {
        source.disconnect();
        if (this.source === source) { this.source = null; this.finish = null; options.onEnd?.(); }
        resolve();
      };
      try { source.start(); options.onStart?.(); } catch (error) { source.disconnect(); this.source = null; this.finish = null; reject(error); }
    });
  }
  cancel(): void {
    this.generation++;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const source = this.source; this.source = null;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
    this.finish?.(); this.finish = null;
  }
  dispose(): void { this.cancel(); void this.context?.close(); this.context = null; }
}
