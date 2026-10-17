import { describe, it, expect } from "vitest";
import { chooseLocalVoice } from "../src/voices";
const local = { voiceURI: "local", localService: true };
const remote = { voiceURI: "remote", localService: false };
describe("private voice selection", () => {
  it("prefers an on-device voice even if a remote voice is first", () =>
    expect(chooseLocalVoice([remote, local], "")).toEqual(local));
  it("uses a local fallback when the saved voice is remote or absent on this device", () => {
    expect(chooseLocalVoice([remote, local], "remote")).toEqual(local);
    expect(chooseLocalVoice([remote, local], "missing")).toEqual(local);
  });
  it("prefers the device default local voice and keeps a valid saved voice", () => {
    const deviceDefault = { voiceURI: "default-local", localService: true, default: true };
    expect(chooseLocalVoice([remote, local, deviceDefault], "")).toEqual(deviceDefault);
    expect(chooseLocalVoice([remote, local, deviceDefault], local.voiceURI)).toEqual(local);
  });
  it("stays silent if no local voices are ready", () => {
    expect(chooseLocalVoice([], "")).toBeUndefined();
    expect(chooseLocalVoice([remote], "")).toBeUndefined();
  });
});
