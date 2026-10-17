// A single pinned model and voice. No user text is ever part of an asset URL.
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
export const MODEL_IDENTITY = `kokoro-js-1.2.1:${MODEL_REVISION}:q8:af_heart:espeak-1.52.0-sayboard-v1`;
export const MODEL_CACHE = `sayboard-tts-${MODEL_REVISION}-q8`;
export const VOICE_CACHE = `${MODEL_CACHE}-voice`;
export const MAX_MODEL_BYTES = 100 * 1024 * 1024;
export const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx', 'voices/af_heart.bin'];
export function pinnedAsset(input: string): string | null {
  const prefix = `https://huggingface.co/${MODEL_ID}/resolve/`;
  if (!input.startsWith(prefix)) return null;
  const [revision, ...parts] = input.slice(prefix.length).split('/');
  const file = parts.join('/');
  if ((revision !== 'main' && revision !== MODEL_REVISION) || !MODEL_FILES.includes(file)) return null;
  return `${prefix}${MODEL_REVISION}/${file}`;
}
