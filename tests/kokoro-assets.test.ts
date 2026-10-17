import { describe, expect, it } from 'vitest';
import { MODEL_ID, MODEL_REVISION, MODEL_FILES, pinnedAsset } from '../src/speech/kokoro-assets';

describe('speech asset boundary', () => {
  it('pins only the model manifest and fixed voice', () => {
    for (const file of MODEL_FILES) {
      expect(pinnedAsset(`https://huggingface.co/${MODEL_ID}/resolve/main/${file}`)).toBe(`https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`);
    }
  });
  it('rejects user text URLs, other voices, revisions, origins, queries and traversal', () => {
    const base = `https://huggingface.co/${MODEL_ID}/resolve/`;
    for (const url of [
      `${base}main/voices/af_bella.bin`, `${base}other/config.json`, `${base}main/../config.json`,
      `${base}main/config.json?text=Help`, 'https://example.org/inference?text=Help',
      `${base}main/onnx/model.onnx`, `${base}main/onnx/model_q4.onnx`,
    ]) expect(pinnedAsset(url)).toBeNull();
  });
});
