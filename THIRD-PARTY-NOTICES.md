# Sayboard browser notices

The combined frontend is GPL-3.0-or-later; original Sayboard modules additionally permit separate MIT reuse. Third-party licences remain applicable. The full licence text and notices are in public/tts-notices.txt and the corresponding-source archives linked from /source/.

- eSpeak NG 1.52.0 and English pronunciation data: GPL-3.0-or-later. Our modified English-only binding and reproducible build recipe replace the opaque packaged phonemizer. Sources include C/C++, dictionary data, glue, recipe and original COPYING.
- Emscripten runtime: MIT and University of Illinois/NCSA; retain LICENSE and AUTHORS in src/speech/vendor/espeak and companion compiler source.
- Kokoro JS 1.2.1 and separately downloaded fixed model/voice: Apache-2.0. The wrapper's licence does not remove eSpeak obligations.
- Transformers.js 3.8.1: Apache-2.0. Pinned dependency preferred sources and notices are supplied for its embedded runtime libraries.
- ONNX Runtime web and common: MIT; native WASM includes third-party notices and preferred sources supplied in companion archives.
- Lucide icons: ISC; see ICON-LICENSE.txt. Emoji/catalogue material: see CATALOGUE-LICENSE.txt.

Archive manifests bind the pinned sources to the runtime versions. No source-delivery condition requires a GitHub account, payment, NDA or special password. Independent backend implementation and user data are outside these browser archives.
