import { describe, expect, it } from "vitest";
import {
  catalogue,
  getEmojiGlyph,
  getIconNode,
  isSymbolId,
  searchSymbols,
  suggestSymbols,
} from "../src/catalogue";

describe("local symbol catalogue", () => {
  it("keeps unrelated partial words out of automatic suggestions", () => {
    expect(suggestSymbols("Demo")).toEqual([]);
    expect(suggestSymbols("🍎")[0]?.label).toBe("red apple");
    expect(suggestSymbols("!!!")).toEqual([]);
    expect(suggestSymbols("Noah").some((entry) => entry.id === "x")).toBe(
      false,
    );
    expect(
      suggestSymbols("painting").some((entry) => entry.id === "heart"),
    ).toBe(false);
    expect(suggestSymbols("I want water")[0]?.id).toBe("glass-water");
  });
  it("ranks communication meanings ahead of incidental label matches", () => {
    expect(searchSymbols("water")[0]?.id).toBe("glass-water");
    expect(searchSymbols("drink")[0]?.id).toBe("cup-soda");
    expect(searchSymbols("glass wat", "icon")[0]?.id).toBe("glass-water");
    expect(
      searchSymbols("ter", "icon").some((entry) => entry.id === "glass-water"),
    ).toBe(false);
  });
  it("bundles broad distinct catalogues and preserves legacy utility IDs", () => {
    expect(
      catalogue.filter((entry) => entry.kind === "icon").length,
    ).toBeGreaterThan(1800);
    expect(
      catalogue.filter((entry) => entry.kind === "emoji").length,
    ).toBeGreaterThan(1800);
    expect(new Set(catalogue.map((entry) => entry.id)).size).toBe(
      catalogue.length,
    );
    for (const id of [
      "home",
      "volume",
      "back",
      "moon",
      "square",
      "cup-soda",
      "circle-help",
    ]) {
      expect(isSymbolId(id)).toBe(true);
      expect(getIconNode(id)).toBeDefined();
    }
    expect(isSymbolId("<script>alert(1)</script>")).toBe(false);
    expect(isSymbolId(null)).toBe(false);
  });
  it("searches labels, names, categories, synonyms and emoji without a network", () => {
    expect(searchSymbols("thirsty", "icon").map((entry) => entry.id)).toContain(
      "cup-soda",
    );
    expect(
      searchSymbols("  WATER  ", "emoji").some(
        (entry) => entry.label === "water wave",
      ),
    ).toBe(true);
    expect(searchSymbols("food drink", "emoji").length).toBeGreaterThan(0);
    const apple = searchSymbols("red apple", "emoji")[0];
    expect(apple?.label).toBe("red apple");
    expect(getEmojiGlyph(apple.id)).toBe("🍎");
    expect(
      searchSymbols("🍎", "emoji").some((entry) => entry.id === apple.id),
    ).toBe(true);
    expect(searchSymbols("totallyunknownword")).toEqual([]);
  });
  it("returns bounded results with predictable exact-name priority", () => {
    expect(searchSymbols("", "all", 12)).toHaveLength(12);
    expect(searchSymbols("cat", "icon", 1)[0]?.id).toBe("cat");
    expect(
      searchSymbols("", "emoji", 4).every((entry) => entry.kind === "emoji"),
    ).toBe(true);
    expect(searchSymbols("", "all", -1)).toEqual([]);
    expect(searchSymbols("", "all", Number.NaN)).toEqual([]);
  });
  it("suggests communication meanings from natural phrases without mutating data", () => {
    const before = JSON.stringify(catalogue);
    expect(
      suggestSymbols("I want to drink water").map((entry) => entry.id),
    ).toContain("cup-soda");
    expect(suggestSymbols("I do not want that")[0]?.id).toBe("minus");
    expect(suggestSymbols("I need help")[0]?.id).toBe("circle-help");
    expect(suggestSymbols("I want")[0]?.id).toBe("heart");
    expect(suggestSymbols("My tummy hurts").map((entry) => entry.id)).toContain(
      "heart",
    );
    expect(suggestSymbols("", 6)).toEqual([]);
    expect(suggestSymbols("happy", 2)).toHaveLength(2);
    expect(JSON.stringify(catalogue)).toBe(before);
  });
});
