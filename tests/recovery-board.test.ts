import { describe, expect, it } from "vitest";
import { parseBoard, type Board, type Tile } from "../src/board";
import { catalogue } from "../src/catalogue";
import { placeTile, type TileSize } from "../src/layout";

function word(id: string, icon = "heart"): Tile {
  return {
    kind: "word",
    id,
    label: "My word",
    phrase: "I choose my own word",
    icon,
    tone: "mint",
  };
}

function board(tiles: (Tile | null)[], size: TileSize = "extra-large"): Board {
  return {
    version: 2,
    subBoards: [],
    tiles,
    size,
    voice: "Australian voice",
    rate: 1.2,
  };
}

function roundtrip(value: Board): Board {
  return parseBoard(JSON.parse(JSON.stringify(value)));
}

describe("recovered board serialization and stable placement", () => {
  it("fills a hole in a 60-slot board and keeps every other position after serialization", () => {
    const original = Array.from({ length: 60 }, (_, index) =>
      word(`word-${index}`),
    );
    const slots: (Tile | null)[] = [...original];
    slots[37] = null;
    const incoming = word("new-custom-word", "emoji:1f34e");
    const result = placeTile(slots, 37, incoming);
    expect(result.kind).toBe("placed");
    if (result.kind !== "placed")
      throw new Error("Expected the empty slot to accept a word");

    const restored = roundtrip(board(result.tiles));
    expect(restored.tiles).toHaveLength(60);
    expect(restored.tiles[37]).toEqual(incoming);
    for (let index = 0; index < 60; index += 1) {
      if (index !== 37) expect(restored.tiles[index]).toEqual(original[index]);
    }
    expect(slots[37]).toBeNull();
  });

  it("moves a tile to the final slot without compacting existing or trailing holes", () => {
    const source = word("status");
    const neighbor = word("app");
    const slots: (Tile | null)[] = Array.from({ length: 60 }, () => null);
    slots[4] = source;
    slots[48] = neighbor;
    const result = placeTile(slots, 59, source);
    expect(result.kind).toBe("placed");
    if (result.kind !== "placed")
      throw new Error("Expected the final empty slot to accept a word");

    const restored = roundtrip(board(result.tiles, "large"));
    expect(restored.tiles[4]).toBeNull();
    expect(restored.tiles[48]).toEqual(neighbor);
    expect(restored.tiles[59]).toEqual(source);
    expect(restored.tiles.filter((tile) => tile !== null)).toHaveLength(2);
    expect(slots[4]).toBe(source);
    expect(slots[59]).toBeNull();
  });

  it("preserves arbitrary imported IDs independently of application element names", () => {
    const ids = [
      "status",
      "app",
      "phrase",
      "__proto__",
      "constructor",
      "a:b #[]",
      "日本語",
    ];
    const current = board(ids.map((id) => word(id)));
    const restored = roundtrip(current);
    expect(restored.tiles.map((tile) => tile?.id)).toEqual(ids);
    expect(restored).toEqual(current);
  });

  it.each<TileSize>(["standard", "large", "extra-large"])(
    "roundtrips a full mixed-symbol board at %s size with custom speech",
    (size) => {
      const emojis = catalogue
        .filter((entry) => entry.kind === "emoji")
        .slice(0, 30);
      const icons = catalogue
        .filter((entry) => entry.kind === "icon")
        .slice(0, 30);
      expect(emojis).toHaveLength(30);
      expect(icons).toHaveLength(30);
      const tiles = [...emojis, ...icons].map((entry, index) => ({
        ...word(`custom-${index}`, entry.id),
        label: `Word ${index + 1}`,
        phrase: `Please say my custom phrase ${index + 1}.`,
      }));
      const current = board(tiles, size);
      expect(roundtrip(current)).toEqual(current);
    },
  );

  it("refuses a full-board collision without moving the source or mutating frozen input", () => {
    const slots = Array.from({ length: 60 }, (_, index) =>
      Object.freeze(word(`word-${index}`)),
    );
    const source = slots[0];
    Object.freeze(slots);
    expect(placeTile(slots, 59, source)).toEqual({
      kind: "occupied",
      occupant: slots[59],
    });
    expect(slots[0]).toBe(source);
    expect(slots.map((tile) => tile.id)).toEqual(
      Array.from({ length: 60 }, (_, index) => `word-${index}`),
    );
  });
});
