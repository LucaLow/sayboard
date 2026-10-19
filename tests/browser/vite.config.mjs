import {fileURLToPath} from "node:url";
export default {resolve:{alias:{phonemizer:fileURLToPath(new URL("../../src/speech/phonemizer.ts",import.meta.url))}},worker:{format:'es'},build:{outDir:'test-results/browser',rollupOptions:{input:'tests/browser/speech.html'}}};
