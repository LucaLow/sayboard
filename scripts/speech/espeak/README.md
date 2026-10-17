# Source-built English phonemizer

Sayboard replaces the opaque `phonemizer@1.2.1` runtime through a Vite alias with `src/speech/phonemizer.ts`. The npm dependency remains in the lockfile because Kokoro declares it, but the browser build does not bundle it. The replacement uses the original pinned Kokoro q8 model and fixed `af_heart` voice. Model weights remain outside Git.

The eSpeak NG component is GPL-3.0-or-later. The wrapper binding and this recipe use the same terms. Preserve `COPYING`, upstream copyright notices and the Emscripten MIT/NCSA notices when conveying the compiled component. Joe authorized GPL-3.0-or-later source delivery for the complete combined browser frontend, without changing repository visibility or publishing the separately running backend.

## Rebuild

Use eSpeak NG 1.52.0 commit `4870adfa25b1a32b4361592f1be8a40337c58d6c`, Emscripten 3.1.64 compiler release `fd61bacaf40131f74987e649a135f1dd559aff60`, compiler source revision `a1fe3902bf73a3802eae0357d273d0e37ea79898`, CMake 4.4.4, GCC 14.2.0 for native dictionary generation, Python 3.12.14 and GNU Make 4.4.1. The compiler's version command records the compiler release. The SDK's bundled Node was 24.19.0. CMake fetches the pinned Sonic source `fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104` even though Sonic is disabled and not linked.

Install/activate Emscripten 3.1.64 with `emsdk install 3.1.64` and `emsdk activate 3.1.64` in a writable tools directory. Set `EMSDK_ROOT`, `CMAKE_BIN`, `ESPEAK_SOURCE` and an empty `BUILD_ROOT`, then run `scripts/speech/espeak/build.sh`. The result is in `$BUILD_ROOT/output`. The source archive contains the original upstream tree and this recipe in `sayboard-recipe`. From that archive run `sayboard-recipe/build.sh`. Its included pinned Sonic sources avoid the CMake dependency fetch. It does not require an eSpeak source patch.

The native build compiles pronunciation data from the pinned upstream sources. Only English dictionaries/voice definitions and shared phoneme tables are embedded in the final module. An explicit wchar.h include resolves declaration conflicts between the upstream compatibility macros and the compiler's musl headers. `glue.c` exports bounded IPA conversion, version reporting and synchronous initialisation. It neither sends text over a network nor synthesises eSpeak audio. The binding accepts only `en-us` and `en`, matching this fixed US voice feature.

Two separate cloud builds, in distinct build directories, produced these identical SHA-256 digests:

| Artifact | SHA-256 |
| --- | --- |
| espeak.js | `9d9d2db89f54b46b617f7b72cddc6d9c1b7bcc5d8e6079f675321169ae0f4e89` |
| espeak.wasm | `60b5f8fc32e6adb76899fa992e07891feaad7004b16e16504d49cae4cbdb82a1` |

This is verified repeatability with the stated cloud toolchain, not a claim about every operating system/compiler. The binary reports eSpeak 1.52.0. The fresh and opaque original phonemizers produced exactly the same IPA for Yes, No, Help, Stop, I need water, Please wait, I feel sick., and Where is Mum?. The browser test runs the replacement through real Kokoro inference.

## Source delivery

The release build runs `scripts/speech/release/assemble.py`. It fetches hash-locked preferred eSpeak/Sonic sources and assembles `espeak-source.tar.gz` with this recipe and notices. The frontend package and every bundled runtime dependency's preferred sources are separately available beside it through `/source/index.html`. The manifest records the actual release archive hashes. Emscripten 3.1.64 sources include the linked musl C library/runtime preferred code.

The initial private archive was verified by rebuilding from its extracted recipe, with the same binary hashes. The deterministic release package preserves those preferred pronunciation sources, the complete pinned eSpeak tree, and the unchanged glue/build recipe. eSpeak's `phsource` WAV files are necessary upstream phoneme source data. They are not user recordings, generated speech, or neural model weights.

The combined browser frontend is distributed under GPL-3.0-or-later with no-charge corresponding source access. Preserve the root licence, third-party notices and component licences. The private repository, independently running backend, credentials and user data are excluded. Recipients may redistribute the released GPL-covered sources.
