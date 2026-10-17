import { describe, expect, it } from "vitest";
import { parseBoard, starterBoard } from "../src/board";
import { chooseLocalVoice } from "../src/voices";

function demoTile() {
  const tile = starterBoard().tiles[0];
  if (!tile) throw new Error("Starter tile is missing");
  return tile;
}

function demoBoard() {
  return { version: 1, voice: "", rate: 0.85, tiles: [demoTile()] };
}

describe("QA import boundary", () => {
  it.each([null, false, 1, "board", [], {}, { version: 1 }])(
    "rejects malformed board %# without throwing a property-access error",
    (value) => {
      expect(() => parseBoard(value)).toThrow("Choose a Sayboard file");
    },
  );

  it("accepts exactly 60 stable slots and rejects the 61st", () => {
    const slots = Array.from({ length: 60 }, (_, index) =>
      index === 30 ? { ...demoTile(), id: "demo-middle" } : null,
    );
    expect(parseBoard({ ...demoBoard(), tiles: slots }).tiles).toEqual(slots);
    expect(() =>
      parseBoard({ ...demoBoard(), tiles: [...slots, null] }),
    ).toThrow();
  });

  it.each([
    { id: "" },
    { id: "x".repeat(101) },
    { id: 1 },
    { label: "   " },
    { label: "x".repeat(41) },
    { label: null },
    { phrase: "\n\t " },
    { phrase: "x".repeat(201) },
    { phrase: {} },
    { icon: "__proto__" },
    { tone: "unknown" },
  ])("rejects malformed word %#", (override) => {
    expect(() =>
      parseBoard({ ...demoBoard(), tiles: [{ ...demoTile(), ...override }] }),
    ).toThrow("invalid word");
  });

  it("accepts exact label, phrase and ID limits", () => {
    const tile = {
      ...demoTile(),
      id: "x".repeat(100),
      label: "x".repeat(40),
      phrase: "x".repeat(200),
    };
    expect(parseBoard({ ...demoBoard(), tiles: [tile] }).tiles).toEqual([tile]);
  });

  it("rejects duplicate IDs across intervening empty slots", () => {
    expect(() =>
      parseBoard({ ...demoBoard(), tiles: [demoTile(), null, demoTile()] }),
    ).toThrow("invalid word");
  });

  it("copies validated values without mutating source and drops extra fields", () => {
    const tile = {
      ...demoTile(),
      label: " Demo ",
      phrase: " Demo phrase ",
      extra: true,
    };
    const source = { ...demoBoard(), tiles: [tile, null], unexpected: true };
    const parsed = parseBoard(source);
    expect(parsed.tiles[0]).toEqual({
      ...demoTile(),
      label: "Demo",
      phrase: "Demo phrase",
    });
    expect(parsed).not.toHaveProperty("unexpected");
    expect(tile.label).toBe(" Demo ");
    expect(parsed.tiles).not.toBe(source.tiles);
    expect(parsed.tiles[0]).not.toBe(tile);
    expect(parsed.tiles[1]).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, 0.49, 1.51, "0.85", null])(
    "defaults invalid speech rate %#",
    (rate) => expect(parseBoard({ ...demoBoard(), rate }).rate).toBe(0.85),
  );

  it.each([0.5, 1.5])("accepts supported rate boundary %s", (rate) => {
    expect(parseBoard({ ...demoBoard(), rate }).rate).toBe(rate);
  });

  it("preserves the saved preference while choosing an available local fallback", () => {
    const board = parseBoard({ ...demoBoard(), voice: "demo-missing" });
    expect(board.voice).toBe("demo-missing");
    expect(
      chooseLocalVoice(
        [{ voiceURI: "demo-local", localService: true }],
        board.voice,
      ),
    ).toEqual({ voiceURI: "demo-local", localService: true });
    expect(board.voice).toBe("demo-missing");
  });
});

describe("QA local voice privacy", () => {
  const remote = { voiceURI: "demo-remote", localService: false };
  const local = { voiceURI: "demo-local", localService: true };

  it("uses a local match when a remote voice has the same URI", () => {
    expect(
      chooseLocalVoice(
        [{ ...remote, voiceURI: local.voiceURI }, local],
        local.voiceURI,
      ),
    ).toBe(local);
  });

  it("uses only an on-device fallback for a saved remote voice", () => {
    expect(chooseLocalVoice([remote, local], remote.voiceURI)).toBe(local);
  });

  it("handles asynchronous empty lists and local voice removal without remote fallback", () => {
    expect(chooseLocalVoice([], "")).toBeUndefined();
    expect(chooseLocalVoice([remote, local], "")).toBe(local);
    expect(chooseLocalVoice([remote], local.voiceURI)).toBeUndefined();
  });
});
