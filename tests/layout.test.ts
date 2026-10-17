import { describe, expect, it } from "vitest";
import { isTileSize, placeTile } from "../src/layout";

const yes = { id: "yes", label: "Yes" };
const no = { id: "no", label: "No" };

describe("deliberate placement", () => {
  it("moves into an empty slot without shifting other words", () => {
    const original = [yes, no, null];
    expect(placeTile(original, 2, yes)).toEqual({
      kind: "placed",
      tiles: [null, no, yes],
    });
    expect(original).toEqual([yes, no, null]);
  });

  it("refuses an occupied position without changing the source", () => {
    const original = [yes, no];
    expect(placeTile(original, 1, yes)).toEqual({
      kind: "occupied",
      occupant: no,
    });
    expect(original).toEqual([yes, no]);
  });

  it("updates a word in its own position", () => {
    const updated = { ...yes, label: "Absolutely" };
    expect(placeTile([yes, no], 0, updated)).toEqual({
      kind: "placed",
      tiles: [updated, no],
    });
  });

  it("pads new positions with empty slots and preserves trailing gaps", () => {
    expect(placeTile([yes, null], 4, no)).toEqual({
      kind: "placed",
      tiles: [yes, null, null, null, no],
    });
    expect(placeTile([yes, no, null], 0, no)).toEqual({
      kind: "occupied",
      occupant: yes,
    });
    expect(placeTile([null, yes, null], 0, yes)).toEqual({
      kind: "placed",
      tiles: [yes, null, null],
    });
  });

  it("allows the last supported slot and rejects invalid positions", () => {
    const result = placeTile([], 59, yes);
    expect(result.kind).toBe("placed");
    if (result.kind === "placed") {
      expect(result.tiles).toHaveLength(60);
      expect(result.tiles[59]).toBe(yes);
      expect(result.tiles.slice(0, 59).every((slot) => slot === null)).toBe(
        true,
      );
    }
    for (const index of [-1, 60, 1.5, NaN, Infinity]) {
      expect(placeTile([yes], index, no).kind).toBe("invalid");
    }
    expect(
      placeTile(
        Array.from({ length: 61 }, () => null),
        0,
        yes,
      ).kind,
    ).toBe("invalid");
  });
});

describe("tile size boundary", () => {
  it("accepts only supported sizes", () => {
    for (const size of ["small", "standard", "large", "extra-large"]) {
      expect(isTileSize(size)).toBe(true);
    }
    for (const size of ["tiny", "", null, undefined, 2, {}]) {
      expect(isTileSize(size)).toBe(false);
    }
  });
});
