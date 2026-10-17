// GPL-3.0-or-later. Thin binding for our source-built eSpeak NG 1.52.0.
import create from './vendor/espeak/espeak.js';
import wasmUrl from './vendor/espeak/espeak.wasm?url';
export const PHONEMIZER_WASM_URL = wasmUrl;
let runtime: ReturnType<typeof create> | undefined;
export async function phonemize(text: string, language = 'en-us'): Promise<string[]> {
  if (language !== 'en-us' && language !== 'en') throw new Error('Unsupported speech language');
  runtime ??= create({ locateFile: file => file.endsWith('.wasm') ? wasmUrl : file }).then(module => {
    if (module.ccall('version', 'string', [], []) !== '1.52.0' || module.ccall('init', 'number', [], []) <= 0) throw new Error('Speech phonemizer unavailable');
    return module;
  });
  const module = await runtime;
  const result = module.ccall('phonemize', 'string', ['string', 'string'], [text, language]);
  if (result === null) throw new Error('Speech phonemizer failed');
  return result.split('\n').filter(Boolean);
}
