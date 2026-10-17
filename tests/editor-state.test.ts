import { describe, expect, it } from "vitest";
import { parseBoard, starterBoard } from "../src/board";
import { hasBoardChanges } from "../src/editor-state";
import { resolveColumns } from "../src/device-layout";

function categoryBoard() {
  const board = starterBoard();
  const category = board.tiles.find((tile) => tile?.kind === "category");
  const child = board.subBoards[0];
  if (category?.kind !== "category" || !child)
    throw new Error("Starter category is missing");
  board.tiles.push({ ...category, id: "food", subBoardId: "foods" });
  board.subBoards.push({
    ...child,
    id: "foods",
    tiles: child.tiles.map(
      (tile) => tile && { ...tile, id: `food-${tile.id}` },
    ),
  });
  return parseBoard(board);
}

describe("caregiver dirty state", () => {
  it("treats clones and equivalent parsed account boards as unchanged", () => {
    const board = starterBoard();
    expect(hasBoardChanges(board, structuredClone(board))).toBe(false);
    expect(hasBoardChanges(board, parseBoard(board))).toBe(false);
  });
  it("detects changes in settings, tile meaning and stable positions", () => {
    const board = starterBoard();
    for (const change of [
      (draft: typeof board) => {
        draft.voice = "other";
      },
      (draft: typeof board) => {
        draft.rate = 1;
      },
      (draft: typeof board) => {
        draft.size = "large";
      },
      (draft: typeof board) => {
        if (draft.tiles[0]) draft.tiles[0].phrase = "different";
      },
      (draft: typeof board) => {
        draft.tiles[0] = null;
      },
      (draft: typeof board) => {
        draft.tiles.reverse();
      },
      (draft: typeof board) => {
        draft.tiles.push(null);
      },
    ]) {
      const draft = structuredClone(board);
      change(draft);
      expect(hasBoardChanges(board, draft)).toBe(true);
    }
    const draft = structuredClone(board);
    draft.rate = 1;
    draft.rate = board.rate;
    expect(hasBoardChanges(board, draft)).toBe(false);
  });

  it("ignores sub-board array order and object key order", () => {
    const board = categoryBoard();
    const draft = structuredClone(board);
    draft.subBoards.reverse();
    const reordered = {
      subBoards: draft.subBoards.map((child) => ({
        size: child.size,
        tiles: child.tiles.map((tile) => {
          if (!tile) return null;
          const { tone, ...fields } = tile;
          return { tone, ...fields };
        }),
        id: child.id,
      })),
      rate: draft.rate,
      voice: draft.voice,
      tiles: draft.tiles,
      size: draft.size,
      version: draft.version,
    };
    expect(hasBoardChanges(board, reordered)).toBe(false);
    expect(hasBoardChanges(reordered, board)).toBe(false);
  });

  it("detects child-word-only edits to every saved word field", () => {
    const board = categoryBoard();
    for (const change of [
      { id: "changed-id" },
      { label: "Changed label" },
      { phrase: "Changed phrase" },
      { icon: "heart" },
      { tone: "mint" },
    ]) {
      const draft = structuredClone(board);
      const child = draft.subBoards[0];
      const tile = child.tiles[0];
      if (!tile) throw new Error("Expected child word");
      // Parsed input keeps the variants and tone narrow while exercising the
      // real shared board boundary for each independently changed word field.
      child.tiles[0] = parseBoard({
        ...draft,
        tiles: [{ ...tile, ...change }],
        subBoards: [],
      }).tiles[0];
      expect(hasBoardChanges(board, draft)).toBe(true);
      expect(hasBoardChanges(draft, board)).toBe(true);
    }
  });

  it("detects child sizes, stable holes, reorders, and added or removed words", () => {
    const board = categoryBoard();
    for (const change of [
      (draft: typeof board) => {
        draft.subBoards[0].size = "large";
      },
      (draft: typeof board) => {
        draft.subBoards[0].tiles.reverse();
      },
      (draft: typeof board) => {
        draft.subBoards[0].tiles[0] = null;
      },
      (draft: typeof board) => {
        draft.subBoards[0].tiles.push(null);
      },
      (draft: typeof board) => {
        const child = draft.subBoards[0];
        const tile = child.tiles[0];
        if (!tile) throw new Error("Expected child word");
        child.tiles.push({ ...tile, id: "new-word" });
      },
    ]) {
      const draft = structuredClone(board);
      change(draft);
      expect(hasBoardChanges(board, draft)).toBe(true);
    }
  });

  it("detects category ownership changes even when every word is unchanged", () => {
    const board = categoryBoard();
    const draft = structuredClone(board);
    const categories = draft.tiles.filter((tile) => tile?.kind === "category");
    const first = categories[0];
    const second = categories[1];
    if (first?.kind !== "category" || second?.kind !== "category")
      throw new Error("Expected two categories");
    [first.subBoardId, second.subBoardId] = [
      second.subBoardId,
      first.subBoardId,
    ];
    expect(hasBoardChanges(board, parseBoard(draft))).toBe(true);
  });

  it("detects category-to-word and word-to-category kind changes", () => {
    const board = starterBoard();
    const draft = structuredClone(board);
    const index = draft.tiles.findIndex((tile) => tile?.kind === "category");
    const tile = draft.tiles[index];
    if (tile?.kind !== "category") throw new Error("Expected category");
    const { subBoardId, ...fields } = tile;
    draft.tiles[index] = { ...fields, kind: "word" };
    // Compare the kind by itself before completing the category removal.
    expect(hasBoardChanges(board, draft)).toBe(true);
    expect(hasBoardChanges(draft, board)).toBe(true);
    draft.subBoards = draft.subBoards.filter(
      (child) => child.id !== subBoardId,
    );
    expect(hasBoardChanges(board, parseBoard(draft))).toBe(true);
    expect(hasBoardChanges(draft, board)).toBe(true);
  });

  it("detects added or removed children and changed child IDs", () => {
    const board = categoryBoard();
    const removed = structuredClone(board);
    removed.subBoards.pop();
    expect(hasBoardChanges(board, removed)).toBe(true);
    expect(hasBoardChanges(removed, board)).toBe(true);
    const renamed = structuredClone(board);
    renamed.subBoards[0].id = "renamed";
    expect(hasBoardChanges(board, renamed)).toBe(true);
  });

  it("clears child dirty state when an edit is undone", () => {
    const board = categoryBoard();
    const draft = structuredClone(board);
    const child = draft.subBoards[0];
    const tile = child.tiles[0];
    if (!tile) throw new Error("Expected child word");
    const phrase = tile.phrase;
    tile.phrase = "Temporary edit";
    expect(hasBoardChanges(board, draft)).toBe(true);
    tile.phrase = phrase;
    expect(hasBoardChanges(board, draft)).toBe(false);
  });
});

describe("device layout", () => {
  it("preserves a customized board's legacy column count on first upgrade", () => {
    expect(resolveColumns(null, 1440, "large")).toBe(4);
    expect(resolveColumns(null, 768, "large")).toBe(3);
    expect(resolveColumns(null, 1440, "extra-large")).toBe(3);
    expect(resolveColumns(null, 768, "extra-large")).toBe(2);
    expect(resolveColumns(null, 390, "extra-large")).toBe(1);
    expect(resolveColumns("5", 390, "extra-large")).toBe(5);
  });
  it("keeps a chosen column count across phone, tablet and desktop widths", () => {
    for (const width of [320, 390, 768, 1024, 1440]) {
      expect(resolveColumns("3", width)).toBe(3);
    }
    expect(resolveColumns(null, 390)).toBe(2);
    expect(resolveColumns(null, 768)).toBe(4);
    expect(resolveColumns(null, 1440)).toBe(5);
    expect(resolveColumns("invalid", 390)).toBe(2);
  });
});
