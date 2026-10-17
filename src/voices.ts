/** Voice providers can be added here without changing the board data model.
 * Only browser-declared local voices are eligible in this private prototype. */
export function chooseLocalVoice<
  T extends { voiceURI: string; localService: boolean; default?: boolean },
>(voices: T[], savedVoice: string): T | undefined {
  return (
    (savedVoice
      ? voices.find(
          (voice) => voice.voiceURI === savedVoice && voice.localService,
        )
      : undefined) ??
    voices.find((voice) => voice.localService && voice.default) ??
    voices.find((voice) => voice.localService)
  );
}
