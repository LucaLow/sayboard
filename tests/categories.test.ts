import { describe, expect, it } from "vitest";
import { parseBoard, starterBoard } from "../src/board";
import legacyJson from "./fixtures/legacy-custom-board.json?raw";

function word(id = "water") {
  return {
    kind: "word",
    id,
    label: "Water",
    phrase: "I want water",
    icon: "emoji:1f4a7",
    tone: "blue",
  };
}

function category(id = "drink", subBoardId = "drinks") {
  return {
    ...word(id),
    kind: "category",
    label: "Drink",
    phrase: "Drink",
    icon: "cup-soda",
    subBoardId,
  };
}

function fixture() {
  return {
    version: 2,
    tiles: [null, category(), null, word("yes"), null],
    voice: "unavailable-custom-local-voice",
    rate: 1.2,
    size: "extra-large",
    subBoards: [{ id: "drinks", tiles: [null, word(), null], size: "large" }],
  };
}

function legacyFixture(): Record<string, unknown> & { tiles: unknown[] } {
  const value: unknown = JSON.parse(legacyJson);
  if (typeof value !== "object" || value === null || !("tiles" in value))
    throw new Error("Legacy fixture must be a board object");
  if (!Array.isArray(value.tiles))
    throw new Error("Legacy fixture must contain slots");
  return { ...value, tiles: value.tiles };
}

describe("category schema migration", () => {
  it("migrates genuine v1 custom words and holes without changing input", () => {
    const original = legacyFixture();
    const before = JSON.stringify(original);
    const expected = {
      ...original,
      version: 2,
      subBoards: [],
      tiles: original.tiles.map((tile: unknown) => {
        if (tile === null) return null;
        if (typeof tile !== "object")
          throw new Error("Invalid legacy fixture tile");
        return { ...tile, kind: "word" };
      }),
    };
    expect(parseBoard(original)).toEqual(expected);
    expect(JSON.stringify(original)).toBe(before);
    expect(parseBoard(original).tiles[0]).toMatchObject({
      id: "custom-drink",
      kind: "word",
      phrase: "My usual drink please",
    });
    expect(parseBoard(original).tiles.map((tile) => tile?.id ?? null)).toEqual([
      "custom-drink",
      null,
      "__proto__",
      null,
      "日本語",
      null,
    ]);
  });

  it("defaults the size of a genuine pre-size v1 board", () => {
    const { size, ...original } = legacyFixture();
    expect(size).toBe("extra-large");
    expect(parseBoard(original)).toMatchObject({
      version: 2,
      size: "standard",
      subBoards: [],
    });
  });

  it.each([
    { subBoards: [] },
    { subBoards: [{ id: "lost", tiles: [word()], size: "standard" }] },
    { tiles: [category()] },
    { tiles: [{ ...word(), subBoardId: "lost" }] },
  ])(
    "rejects v1 hierarchy markers rather than dropping children %#",
    (extra) => {
      expect(() => parseBoard({ ...legacyFixture(), ...extra })).toThrow();
    },
  );

  it("limits the Drinks demo to fresh starter boards", () => {
    const fresh = starterBoard();
    expect(parseBoard(fresh)).toEqual(fresh);
    expect(fresh).toMatchObject({
      version: 2,
      tiles: expect.arrayContaining([
        expect.objectContaining({ kind: "category", label: "Drink" }),
      ]),
      subBoards: expect.arrayContaining([
        expect.objectContaining({
          tiles: expect.arrayContaining([
            expect.objectContaining({ kind: "word", label: "Water" }),
            expect.objectContaining({ kind: "word", label: "Milk" }),
            expect.objectContaining({ kind: "word", label: "Juice" }),
          ]),
        }),
      ]),
    });
    expect(parseBoard(legacyFixture())).toMatchObject({ subBoards: [] });
  });
});

describe("category serialization boundary", () => {
  it("roundtrips the full hierarchy, independent sizes and speech settings", () => {
    const original = fixture();
    const serialized = JSON.stringify(original);
    expect(parseBoard(JSON.parse(serialized))).toEqual(original);
    const parsed = parseBoard(original);
    expect(parsed).toEqual(original);
    expect(parsed).not.toBe(original);
    expect(parsed.tiles).not.toBe(original.tiles);
    expect(parsed.tiles[1]).not.toBe(original.tiles[1]);
    expect(JSON.stringify(original)).toBe(serialized);
    expect(parseBoard(parsed)).toEqual(parsed);
  });

  it("allows empty categories represented by one stable null slot", () => {
    const original = fixture();
    const expected = {
      ...original,
      subBoards: [{ ...original.subBoards[0], tiles: [null] }],
    };
    expect(parseBoard(expected)).toEqual(expected);
  });

  it("preserves multiple independently owned categories", () => {
    const expected = {
      ...fixture(),
      tiles: [category(), null, category("food", "foods")],
      subBoards: [
        { id: "drinks", size: "standard", tiles: [word()] },
        { id: "foods", size: "large", tiles: [null, word("apple"), null] },
      ],
    };
    expect(parseBoard(expected)).toEqual(expected);
  });

  it("preserves all 60 root and child slots with leading and trailing gaps", () => {
    const expected = {
      ...fixture(),
      tiles: Array.from({ length: 60 }, (_, index) =>
        index === 42 ? category() : null,
      ),
      subBoards: [
        {
          id: "drinks",
          size: "standard",
          tiles: Array.from({ length: 60 }, (_, index) =>
            index === 37 ? word() : null,
          ),
        },
      ],
    };
    expect(parseBoard(JSON.parse(JSON.stringify(expected)))).toEqual(expected);
  });

  it("accepts prototype-like and Unicode sub-board IDs as ordinary IDs", () => {
    for (const id of ["__proto__", "constructor", "日本語"]) {
      const expected = {
        ...fixture(),
        tiles: [category("category-id", id)],
        subBoards: [{ id, size: "large", tiles: [word("__proto__")] }],
      };
      expect(parseBoard(expected)).toEqual(expected);
    }
  });

  it.each([0, 3, "2", null])(
    "rejects unsupported board version %s",
    (version) => {
      expect(() => parseBoard({ ...fixture(), version })).toThrow();
    },
  );

  it.each([
    { subBoards: undefined },
    { subBoards: null },
    { subBoards: {} },
    { tiles: [{ ...word(), kind: undefined }] },
    { tiles: [{ ...word(), kind: "unknown" }] },
    { tiles: [{ ...category(), subBoardId: undefined }] },
    { tiles: [{ ...category(), subBoardId: "" }] },
    { tiles: [{ ...category(), subBoardId: 1 }] },
    { tiles: [{ ...word(), subBoardId: "drinks" }] },
  ])("rejects malformed v2 structure or discriminants %#", (extra) => {
    expect(() => parseBoard({ ...fixture(), ...extra })).toThrow();
  });

  it.each([[], Array.from({ length: 61 }, () => null)])(
    "rejects invalid slot count at root and inside a category %#",
    (tiles) => {
      expect(() => parseBoard({ ...fixture(), tiles })).toThrow();
      expect(() =>
        parseBoard({
          ...fixture(),
          subBoards: [{ id: "drinks", size: "large", tiles }],
        }),
      ).toThrow();
    },
  );

  it.each(["gigantic", null, undefined, 1])(
    "rejects invalid root and child sizes %#",
    (size) => {
      expect(() => parseBoard({ ...fixture(), size })).toThrow();
      expect(() =>
        parseBoard({
          ...fixture(),
          subBoards: [{ id: "drinks", tiles: [word()], size }],
        }),
      ).toThrow();
    },
  );

  it.each(["", "x".repeat(101), null, 1])(
    "rejects invalid sub-board IDs %#",
    (id) => {
      expect(() =>
        parseBoard({
          ...fixture(),
          tiles: [{ ...category(), subBoardId: id }],
          subBoards: [{ id, tiles: [word()], size: "large" }],
        }),
      ).toThrow();
    },
  );

  it.each([
    { kind: undefined },
    { kind: "unknown" },
    { id: "" },
    { label: " " },
    { phrase: " " },
    { icon: "javascript:alert(1)" },
    { tone: "unknown" },
    { subBoardId: "drinks" },
  ])(
    "validates child word fields without dropping invalid data %#",
    (extra) => {
      expect(() =>
        parseBoard({
          ...fixture(),
          subBoards: [
            { id: "drinks", size: "large", tiles: [{ ...word(), ...extra }] },
          ],
        }),
      ).toThrow();
    },
  );
});

describe("category ownership and reachability", () => {
  it("rejects missing category targets", () => {
    expect(() => parseBoard({ ...fixture(), subBoards: [] })).toThrow();
  });

  it("rejects orphan sub-boards", () => {
    expect(() => parseBoard({ ...fixture(), tiles: [word("root")] })).toThrow();
  });

  it("rejects two categories owning the same sub-board", () => {
    expect(() =>
      parseBoard({ ...fixture(), tiles: [category(), category("other")] }),
    ).toThrow();
  });

  it("rejects duplicate sub-board IDs", () => {
    const original = fixture();
    expect(() =>
      parseBoard({
        ...original,
        subBoards: [...original.subBoards, ...original.subBoards],
      }),
    ).toThrow();
  });

  it("rejects duplicate tile IDs across root and child boards", () => {
    expect(() =>
      parseBoard({ ...fixture(), tiles: [category(), word()] }),
    ).toThrow();
  });

  it("rejects duplicate tile IDs across separate child boards", () => {
    expect(() =>
      parseBoard({
        ...fixture(),
        tiles: [category(), category("food", "foods")],
        subBoards: [
          { id: "drinks", size: "standard", tiles: [word()] },
          { id: "foods", size: "large", tiles: [word()] },
        ],
      }),
    ).toThrow();
  });

  it("rejects child categories even when their target graph is acyclic", () => {
    expect(() =>
      parseBoard({
        ...fixture(),
        subBoards: [
          { id: "drinks", size: "large", tiles: [category("nested", "more")] },
          { id: "more", size: "standard", tiles: [word()] },
        ],
      }),
    ).toThrow();
  });

  it("rejects self-references and cycles without recursive overflow", () => {
    for (const subBoards of [
      [{ id: "drinks", size: "large", tiles: [category("self", "drinks")] }],
      [
        { id: "drinks", size: "large", tiles: [category("to-more", "more")] },
        { id: "more", size: "large", tiles: [category("to-drinks", "drinks")] },
      ],
    ]) {
      expect(() => parseBoard({ ...fixture(), subBoards })).toThrow();
    }
  });
});
