import { describe, expect, it } from "vitest";
import legacyBytes from "./fixtures/legacy-custom-board.json?raw";
import { parseBoard, starterBoard } from "../src/board";
import {
  currentBoardKey,
  legacyBoardKey,
  recoveryBoardKey,
  loadStoredBoard,
  saveStoredBoard,
  serializeBoard,
} from "../src/board-storage";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("category storage migration and recovery", () => {
  it("migrates a genuine customized legacy board in memory and retains its exact saved bytes", () => {
    const storage = memoryStorage({ [legacyBoardKey]: legacyBytes });
    const loaded = loadStoredBoard(storage);
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind !== "loaded") throw new Error("Expected legacy board");
    expect(loaded.migrated).toBe(true);
    expect(loaded.board.tiles[0]?.phrase).toBe("My usual drink please");
    expect(loaded.board.tiles[1]).toBeNull();
    expect(loaded.board.tiles[2]?.id).toBe("__proto__");
    expect(loaded.board.size).toBe("extra-large");
    expect(storage.data.size).toBe(1);
    saveStoredBoard(storage, loaded.board);
    expect(storage.getItem(legacyBoardKey)).toBe(legacyBytes);
    expect(
      parseBoard(JSON.parse(storage.getItem(currentBoardKey) ?? "null")),
    ).toEqual(loaded.board);
  });

  it("prefers the current board without reviving a different legacy draft", () => {
    const current = starterBoard();
    current.rate = 1.5;
    const storage = memoryStorage({
      [legacyBoardKey]: legacyBytes,
      [currentBoardKey]: JSON.stringify(current),
    });
    expect(loadStoredBoard(storage)).toEqual({
      kind: "loaded",
      board: current,
      migrated: false,
    });
  });

  it.each(["", "{", '{"version":999}'])(
    "retains invalid current bytes %j and refuses fallback",
    (invalid) => {
      const storage = memoryStorage({
        [legacyBoardKey]: legacyBytes,
        [currentBoardKey]: invalid,
      });
      expect(loadStoredBoard(storage).kind).toBe("unavailable");
      expect(storage.getItem(currentBoardKey)).toBe(invalid);
      expect(storage.getItem(legacyBoardKey)).toBe(legacyBytes);
    },
  );

  it("preserves an unreadable current copy before an explicit replacement save", () => {
    const storage = memoryStorage({ [currentBoardKey]: "{broken original" });
    saveStoredBoard(storage, starterBoard());
    expect(storage.getItem(recoveryBoardKey)).toBe("{broken original");
  });

  it("fails before replacing saved data when validation rejects the draft", () => {
    const saved = JSON.stringify(starterBoard());
    const storage = memoryStorage({ [currentBoardKey]: saved });
    const invalid = starterBoard();
    const tile = invalid.tiles[0];
    if (!tile) throw new Error("Missing test tile");
    tile.icon = "<script>";
    expect(() => saveStoredBoard(storage, invalid)).toThrow();
    expect(storage.getItem(currentBoardKey)).toBe(saved);
  });

  it("measures UTF-8 bytes and rejects oversized data without truncation", () => {
    const storage = memoryStorage({ [legacyBoardKey]: legacyBytes });
    const oversized = starterBoard();
    oversized.voice = "声".repeat(40_000);
    expect(() => saveStoredBoard(storage, oversized)).toThrow("too large");
    expect(storage.getItem(currentBoardKey)).toBeNull();
    expect(storage.getItem(legacyBoardKey)).toBe(legacyBytes);
  });

  it("uses compact JSON that imports under the same complete-board cap", () => {
    const board = starterBoard();
    const serialized = serializeBoard(board);
    expect(serialized).not.toContain("\n");
    expect(parseBoard(JSON.parse(serialized))).toEqual(board);
  });

  it("keeps old data when storage denies the new write", () => {
    const storage = memoryStorage({ [legacyBoardKey]: legacyBytes });
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => saveStoredBoard(storage, starterBoard())).toThrow("quota");
    expect(storage.getItem(legacyBoardKey)).toBe(legacyBytes);
  });
});
