// SPDX-License-Identifier: GPL-3.0-or-later
// Sayboard modification, 2026-10-11: bounded IPA-only binding, no synthesis output.
#include <espeak-ng/speak_lib.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <emscripten.h>
EMSCRIPTEN_KEEPALIVE int init(void) { return espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, "/usr/share", 0); }
EMSCRIPTEN_KEEPALIVE const char *version(void) { return espeak_Info(NULL); }
EMSCRIPTEN_KEEPALIVE const char *phonemize(const char *text, const char *voice) {
 static char result[65536]; result[0]=0; const void *p=text;
 if (espeak_SetVoiceByName(voice)!=EE_OK) return NULL;
 while(p){const char *s=espeak_TextToPhonemes(&p,espeakCHARS_UTF8,espeakPHONEMES_IPA);if(!s) break;
 if(strlen(result)+strlen(s)+2>=sizeof result)return NULL;strcat(result,s);if(p)strcat(result,"\n");}return result;
}
