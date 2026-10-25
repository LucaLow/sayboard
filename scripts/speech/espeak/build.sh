#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
: "${EMSDK_ROOT:?Set EMSDK_ROOT to an activated Emscripten 3.1.64 checkout}"
: "${CMAKE_BIN:?Set CMAKE_BIN to cmake, tested with 4.4.4}"
: "${ESPEAK_SOURCE:?Set ESPEAK_SOURCE to the source checkout or archive root}"
: "${BUILD_ROOT:?Set BUILD_ROOT to an empty writable directory}"
recipe=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
emcc="$EMSDK_ROOT/upstream/emscripten/emcc"
emcmake="$EMSDK_ROOT/upstream/emscripten/emcmake"
"$emcc" --version | head -1 | grep -q '3\.1\.64'
if [[ -d "$ESPEAK_SOURCE/.git" ]]; then
  [[ $(git -C "$ESPEAK_SOURCE" rev-parse HEAD) == 4870adfa25b1a32b4361592f1be8a40337c58d6c ]]
fi
flags=(-DBUILD_TESTING=OFF -DUSE_LIBPCAUDIO=OFF -DUSE_LIBSONIC=OFF -DUSE_MBROLA=OFF -DUSE_ASYNC=OFF -DCMAKE_BUILD_TYPE=Release)
if [[ -d "$ESPEAK_SOURCE/sayboard-recipe/sonic" ]]; then flags+=("-DFETCHCONTENT_SOURCE_DIR_SONIC-GIT=$ESPEAK_SOURCE/sayboard-recipe/sonic"); fi
"$CMAKE_BIN" -S "$ESPEAK_SOURCE" -B "$BUILD_ROOT/native" "${flags[@]}"
"$CMAKE_BIN" --build "$BUILD_ROOT/native" -j 5
# musl declares wide-character functions in wchar.h too. Include those declarations
# before upstream's wctype macro aliases; no upstream source patch is needed.
"$emcmake" "$CMAKE_BIN" -S "$ESPEAK_SOURCE" -B "$BUILD_ROOT/wasm" "${flags[@]}" "-DCMAKE_C_FLAGS=-include $EMSDK_ROOT/upstream/emscripten/cache/sysroot/include/wchar.h"
"$CMAKE_BIN" --build "$BUILD_ROOT/wasm" --target espeak-ng -j 5
mkdir -p "$BUILD_ROOT/data/lang/gmw" "$BUILD_ROOT/output"
cp "$BUILD_ROOT/native/espeak-ng-data/"{en_dict,phondata,phontab,phonindex,intonations} "$BUILD_ROOT/data/"
cp "$BUILD_ROOT/native/espeak-ng-data/lang/gmw/"en* "$BUILD_ROOT/data/lang/gmw/"
"$emcc" "$recipe/glue.c" "$BUILD_ROOT/wasm/src/libespeak-ng/libespeak-ng.a" "$BUILD_ROOT/wasm/src/ucd-tools/libucd.a" "$BUILD_ROOT/wasm/src/speechPlayer/libspeechPlayer.a" -I "$ESPEAK_SOURCE/src/include" -lstdc++ -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_RUNTIME_METHODS=ccall -sFILESYSTEM=1 --embed-file "$BUILD_ROOT/data@/usr/share/espeak-ng-data" -o "$BUILD_ROOT/output/espeak.js"
python3 - "$BUILD_ROOT/output/espeak.js" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);p.write_text('// GPL-3.0-or-later. eSpeak NG 1.52.0, 2026-10-11 Sayboard source build. See COPYING and scripts/speech/espeak/README.md.\n'+p.read_text())
PY
cp "$ESPEAK_SOURCE/COPYING" "$BUILD_ROOT/output/"
if command -v sha256sum >/dev/null; then
  sha256sum "$BUILD_ROOT/output/"{espeak.js,espeak.wasm}
else
  shasum -a 256 "$BUILD_ROOT/output/"{espeak.js,espeak.wasm}
fi
