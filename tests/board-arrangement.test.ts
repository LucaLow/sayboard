import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  arrangeTile,
  createArrangementCategory,
} from "../src/board-arrangement";
import { parseBoard, serializeBoard, starterBoard } from "../src/board";

describe("main-board arrangement transactions", () => {
  it("swaps exactly two slots without mutating the source", () => {
    const board = starterBoard();
    const before = serializeBoard(board);
    const result = arrangeTile({
      board,
      pageId: null,
      tileId: "starter-0",
      target: { kind: "slot", index: 3 },
    });
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") throw new Error(result.message);
    expect(result.board.tiles[3]?.id).toBe("starter-0");
    expect(result.board.tiles[0]?.id).toBe("starter-3");
    expect(result.board.tiles[2]).toEqual(board.tiles[2]);
    expect(serializeBoard(board)).toBe(before);
  });
  it("moves into categories and back to the original hole without losing words", () => {
    const board = starterBoard();
    const into = arrangeTile({
      board,
      pageId: null,
      tileId: "starter-0",
      target: { kind: "page", pageId: "starter-drinks" },
    });
    if (into.kind !== "changed") throw new Error(into.message);
    expect(into.board.tiles[0]).toBeNull();
    expect(into.board.subBoards[0].tiles[3]?.id).toBe("starter-0");
    const out = arrangeTile({
      board: into.board,
      pageId: "starter-drinks",
      tileId: "starter-0",
      target: { kind: "page", pageId: null },
    });
    if (out.kind !== "changed") throw new Error(out.message);
    expect(out.board.tiles[0]?.id).toBe("starter-0");
    expect(out.board.subBoards[0].tiles[3]).toBeNull();
    expect(parseBoard(JSON.parse(serializeBoard(out.board)))).toEqual(
      out.board,
    );
  });
  it("rejects nesting, missing destinations, and full targets atomically", () => {
    const board = starterBoard();
    expect(
      arrangeTile({
        board,
        pageId: null,
        tileId: "starter-8",
        target: { kind: "page", pageId: "starter-drinks" },
      }).kind,
    ).toBe("unchanged");
    expect(
      arrangeTile({
        board,
        pageId: null,
        tileId: "starter-0",
        target: { kind: "page", pageId: "missing" },
      }).kind,
    ).toBe("unchanged");
    const sample = board.subBoards[0].tiles[0];
    if (!sample) throw new Error("Fixture word missing");
    board.subBoards[0].tiles = Array.from({ length: 60 }, (_, index) => ({
      ...sample,
      id: `full-${index}`,
    }));
    const before = serializeBoard(board);
    expect(
      arrangeTile({
        board,
        pageId: null,
        tileId: "starter-0",
        target: { kind: "page", pageId: "starter-drinks" },
      }).kind,
    ).toBe("unchanged");
    expect(serializeBoard(board)).toBe(before);
  });
  it("creates categories at the first hole with complete ownership and unchanged sizes", () => {
    const board = starterBoard();
    board.tiles[2] = null;
    board.size = "large";
    const result = createArrangementCategory(board, "  Snacks  ");
    if (result.kind !== "changed") throw new Error(result.message);
    const category = result.board.tiles[2];
    expect(category?.label).toBe("Snacks");
    if (category?.kind !== "category") throw new Error("Category missing");
    expect(
      result.board.subBoards.find((page) => page.id === category.subBoardId),
    ).toEqual({ id: category.subBoardId, size: "large", tiles: [null] });
    expect(parseBoard(JSON.parse(serializeBoard(result.board)))).toEqual(
      result.board,
    );
    expect(board.tiles[2]).toBeNull();
  });
  it("retains migrated legacy custom words and slot holes through arrangement", () => {
    const board = parseBoard(
      JSON.parse(
        readFileSync("tests/fixtures/legacy-custom-board.json", "utf8"),
      ),
    );
    const tile = board.tiles.find((item) => item !== null);
    if (!tile) throw new Error("Fixture word missing");
    const result = createArrangementCategory(board, "Fixture category");
    if (result.kind !== "changed") throw new Error(result.message);
    const category = result.board.tiles.find(
      (item) => item?.kind === "category",
    );
    if (category?.kind !== "category") throw new Error("Category missing");
    const moved = arrangeTile({
      board: result.board,
      pageId: null,
      tileId: tile.id,
      target: { kind: "page", pageId: category.subBoardId },
    });
    if (moved.kind !== "changed") throw new Error(moved.message);
    expect(
      parseBoard(JSON.parse(serializeBoard(moved.board))).subBoards.at(-1)
        ?.tiles[0],
    ).toEqual(tile);
  });
});
