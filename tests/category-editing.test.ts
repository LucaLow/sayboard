import { describe, expect, it } from "vitest";
import {
  boardPage,
  moveTile,
  parseBoard,
  removeTile,
  starterBoard,
} from "../src/board";
import { placeTile } from "../src/layout";

describe("category editing keeps slots and complete ownership", () => {
  it("removes a category and its owned words without compacting the home board", () => {
    const board = starterBoard();
    const original = structuredClone(board.tiles);
    removeTile(board, board, 8);
    expect(board.tiles).toHaveLength(original.length);
    expect(board.tiles[8]).toBeNull();
    original.forEach((tile, index) => {
      if (index !== 8) expect(board.tiles[index]).toEqual(tile);
    });
    expect(board.subBoards).toEqual([]);
    expect(parseBoard(board)).toEqual(board);
  });

  it("removes and reorders child words without changing home words or category sizes", () => {
    const board = starterBoard();
    const home = structuredClone(board.tiles);
    const child = boardPage(board, "starter-drinks");
    child.size = "extra-large";
    const water = child.tiles[0];
    child.tiles = moveTile(child.tiles, 0, 1);
    expect(child.tiles[1]).toEqual(water);
    removeTile(board, child, 0);
    expect(child.tiles).toHaveLength(3);
    expect(child.tiles[0]).toBeNull();
    expect(board.tiles).toEqual(home);
    expect(board.size).toBe("standard");
    expect(parseBoard(board).subBoards[0].size).toBe("extra-large");
  });

  it("moves a child to slot 60 with explicit gaps while retaining every other child", () => {
    const board = starterBoard();
    const child = boardPage(board, "starter-drinks");
    const water = child.tiles[0];
    if (!water) throw new Error("Missing demo word");
    const original = structuredClone(child.tiles);
    const result = placeTile(child.tiles, 59, water);
    expect(result.kind).toBe("placed");
    if (result.kind !== "placed") throw new Error("Expected empty slot");
    child.tiles = result.tiles;
    const restored = parseBoard(JSON.parse(JSON.stringify(board))).subBoards[0];
    expect(restored.tiles).toHaveLength(60);
    expect(restored.tiles[0]).toBeNull();
    expect(restored.tiles[1]).toEqual(original[1]);
    expect(restored.tiles[2]).toEqual(original[2]);
    expect(restored.tiles[59]).toEqual(water);
    expect(restored.tiles.slice(3, 59).every((tile) => tile === null)).toBe(
      true,
    );
  });

  it("keeps a moved category connected to its existing child board", () => {
    const board = starterBoard();
    const child = structuredClone(board.subBoards);
    board.tiles = moveTile(board.tiles, 8, 1);
    expect(board.tiles[9]?.kind).toBe("category");
    expect(parseBoard(board).subBoards).toEqual(child);
  });

  it("rejects sparse arrays instead of manufacturing typed slots from holes", () => {
    const board = starterBoard();
    board.tiles = new Array(5);
    expect(() => parseBoard(board)).toThrow();
  });
});
