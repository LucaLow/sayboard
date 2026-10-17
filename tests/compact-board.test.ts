import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard, starterBoard } from "../src/board";
import { hasBoardChanges } from "../src/editor-state";

describe("small board-size compatibility", () => {
  it("round-trips Small on Home and category pages through the export/import parser", () => {
    const board = starterBoard();
    board.size = "small";
    board.tiles[0] = null;
    board.tiles.push(null);
    for (const page of board.subBoards) {
      page.size = "small";
      page.tiles = [null, ...page.tiles, null];
    }
    expect(parseBoard(JSON.parse(serializeBoard(board)))).toEqual(board);
    expect(JSON.parse(serializeBoard(board))).not.toHaveProperty("columns");
    expect(JSON.parse(serializeBoard(board))).not.toHaveProperty(
      "deviceLayout",
    );
  });
  it("retains all legacy sizes and rejects unsupported sizes in child pages", () => {
    for (const size of ["small", "standard", "large", "extra-large"] as const) {
      const board = starterBoard();
      board.size = size;
      expect(parseBoard(board)).toEqual(board);
    }
    const board = starterBoard();
    expect(() =>
      parseBoard({
        ...board,
        subBoards: board.subBoards.map((page) => ({ ...page, size: "tiny" })),
      }),
    ).toThrow(/unsupported tile size/);
  });
  it("detects Small board-size changes on both Home and child pages", () => {
    const board = starterBoard();
    const draft = structuredClone(board);
    draft.size = "small";
    expect(hasBoardChanges(board, draft)).toBe(true);
    draft.size = board.size;
    draft.subBoards[0].size = "small";
    expect(hasBoardChanges(board, draft)).toBe(true);
  });
});
