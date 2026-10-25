import { afterEach, expect, it, vi } from "vitest";
import { BrowserSpeechOutput } from "../src/speech/browser-output";

afterEach(() => vi.unstubAllGlobals());
it("never starts audio when Stop was pressed while the audio context was resuming", async () => {
  let finish: (() => void) | undefined;
  const resumed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const createBuffer = vi.fn();
  class Context {
    state = "running";
    resume = () => resumed;
    createBuffer = createBuffer;
    close = async () => {};
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("window", { speechSynthesis: { cancel: vi.fn() } });
  const output = new BrowserSpeechOutput();
  const start = vi.fn();
  output.unlock();
  const playing = output.play(
    { samples: new Float32Array([0.1]), sampleRate: 24000 },
    { onStart: start },
  );
  output.cancel();
  finish?.();
  await playing;
  expect(createBuffer).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  output.dispose();
});

it("rechecks late device voices inside system speech without a startup snapshot", () => {
  const local = { voiceURI: "late-local", localService: true };
  const speak = vi.fn();
  class Utterance {
    voice: unknown;
    rate = 1;
    constructor(public text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("window", {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { getVoices: () => [local], speak },
  });
  const output = new BrowserSpeechOutput();
  output.system("Help", {});
  expect(speak).toHaveBeenCalledOnce();
  expect(speak.mock.calls[0][0]).toMatchObject({ text: "Help", voice: local });
});

it("never invokes an unspecified default or remote voice when local voices are absent", () => {
  const speak = vi.fn();
  const error = vi.fn();
  class Utterance {}
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("window", {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "remote", localService: false }],
      speak,
    },
  });
  new BrowserSpeechOutput().system("Help", { onError: error });
  expect(speak).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledOnce();
});

it("keeps the device utterance referenced until it ends or is cancelled", () => {
  const local = { voiceURI: "local", localService: true };
  const speak = vi.fn();
  const end = vi.fn();
  class Utterance {
    voice: unknown;
    rate = 1;
    onend?: () => void;
    constructor(public text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("window", {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { getVoices: () => [local], speak, cancel: vi.fn() },
  });
  const output = new BrowserSpeechOutput();
  output.system("Help", { onEnd: end });
  const first: Utterance = speak.mock.calls[0][0];
  expect(output["utterance"]).toBe(first);
  first.onend?.();
  expect(end).toHaveBeenCalledOnce();
  expect(output["utterance"]).toBeNull();
  output.system("Water", {});
  expect(output["utterance"]).toBe(speak.mock.calls[1][0]);
  output.cancel();
  expect(output["utterance"]).toBeNull();
});

it("resolves the original saved URI when that voice arrives after startup", () => {
  const fallback = { voiceURI: "fallback-local", localService: true };
  const saved = { voiceURI: "saved-local", localService: true };
  const speak = vi.fn();
  class Utterance {
    voice: unknown;
    rate = 1;
    constructor(public text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("window", {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { getVoices: () => [fallback, saved], speak },
  });
  new BrowserSpeechOutput().system("Help", { systemVoiceURI: saved.voiceURI });
  expect(speak).toHaveBeenCalledOnce();
  expect(speak.mock.calls[0][0]).toMatchObject({ text: "Help", voice: saved });
});
