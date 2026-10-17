import { describe, it, expect } from "vitest";
import { starterBoard, parseBoard, moveTile } from "../src/board";
import legacyBytes from "./fixtures/legacy-custom-board.json?raw";
describe("board file boundary", () => {
  it("roundtrips a board with stable empty slots", () => {
    const board = starterBoard();
    board.tiles[2] = null;
    expect(parseBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
  });
  it("rejects malformed and duplicate data", () => {
    const board = starterBoard();
    expect(() => parseBoard({ version: 1, tiles: [] })).toThrow();
    board.tiles[1] = board.tiles[0];
    expect(() => parseBoard(board)).toThrow();
    expect(() => parseBoard({ version: 2, tiles: [null] })).toThrow();
  });
  it("rejects untrusted icons and oversized labels", () => {
    const board = starterBoard();
    const tile = board.tiles[0];
    expect(() =>
      parseBoard({ ...board, tiles: [{ ...tile, icon: "<script>" }] }),
    ).toThrow();
    expect(() =>
      parseBoard({ ...board, tiles: [{ ...tile, label: "x".repeat(41) }] }),
    ).toThrow();
  });
  it("reorders only on an explicit move and leaves input untouched", () => {
    const board = starterBoard();
    const moved = moveTile(board.tiles, 0, 1);
    expect(moved[1]).toEqual(board.tiles[0]);
    expect(board.tiles[0]?.label).toBe("Yes");
    expect(moveTile(board.tiles, 0, -1)).toEqual(board.tiles);
  });
});

describe("catalogue and size migration", () => {
  it("reads older version-1 boards without a size preference", () => {
    const legacy = JSON.parse(legacyBytes);
    expect(legacy.version).toBe(1);
    const { size: legacySize, ...withoutSize } = legacy;
    expect(legacySize).toBe("extra-large");
    expect(parseBoard(withoutSize).size).toBe("standard");
  });
  it("roundtrips emoji symbols and larger sizes", () => {
    const current = starterBoard();
    current.size = "extra-large";
    const tile = current.tiles[0];
    if (tile) tile.icon = "emoji:1f34e";
    expect(parseBoard(JSON.parse(JSON.stringify(current)))).toEqual(current);
  });
  it("rejects unknown symbols and invalid sizes", () => {
    const current = starterBoard();
    expect(() => parseBoard({ ...current, size: "enormous" })).toThrow();
    expect(() =>
      parseBoard({
        ...current,
        tiles: [{ ...current.tiles[0], icon: "emoji:invalid" }],
      }),
    ).toThrow();
  });
});
