import { isSymbolId } from "./catalogue.js";
import { isTileSize, type TileSize } from "./layout.js";
export const iconNames = [
  "check",
  "x",
  "hand",
  "circle-help",
  "plus",
  "minus",
  "heart",
  "smile",
  "frown",
  "cup-soda",
  "utensils",
  "toilet",
  "bed",
  "person-standing",
  "home",
  "users",
  "play",
  "music",
  "book-open",
  "sun",
  "message-circle",
  "arrow-right",
  "ear",
  "star",
] as const;
export type IconName = string;
type TileFields = {
  id: string;
  label: string;
  phrase: string;
  icon: IconName;
  tone: "mint" | "peach" | "blue" | "lavender";
};
export type WordTile = TileFields & { kind: "word" };
export type CategoryTile = TileFields & {
  kind: "category";
  subBoardId: string;
};
export type Tile = WordTile | CategoryTile;
export type BoardPage = { tiles: (Tile | null)[]; size: TileSize };
export type SubBoard = BoardPage & { id: string };
export type Board = BoardPage & {
  version: 2;
  subBoards: SubBoard[];
  voice: string;
  rate: number;
};
export const maximumBoardBytes = 99_000;
export function isIcon(value: unknown): value is IconName {
  return isSymbolId(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

/** One boundary for local drafts, file transfers, and both account stores. */
export function parseBoard(value: unknown): Board {
  if (!record(value) || (value.version !== 1 && value.version !== 2))
    throw new Error("Choose a Sayboard file with a supported board version.");
  const legacy = value.version === 1;
  if (legacy && "subBoards" in value)
    throw new Error(
      "A version-1 file cannot contain category boards. Its words have not changed.",
    );
  const tileIds = new Set<string>();
  function parsePage(page: Record<string, unknown>, child: boolean): BoardPage {
    if (
      !Array.isArray(page.tiles) ||
      page.tiles.length < 1 ||
      page.tiles.length > 60
    )
      throw new Error("Choose a Sayboard file with 1–60 words per board.");
    if ("size" in page && !isTileSize(page.size))
      throw new Error("This file contains an unsupported tile size.");
    const tiles: (Tile | null)[] = Array.from(page.tiles, (tile: unknown) => {
      if (tile === null) return null;
      if (
        !record(tile) ||
        !validId(tile.id) ||
        tileIds.has(tile.id) ||
        typeof tile.label !== "string" ||
        !tile.label.trim() ||
        tile.label.length > 40 ||
        typeof tile.phrase !== "string" ||
        !tile.phrase.trim() ||
        tile.phrase.length > 200 ||
        !isIcon(tile.icon) ||
        (tile.tone !== "mint" &&
          tile.tone !== "peach" &&
          tile.tone !== "blue" &&
          tile.tone !== "lavender")
      )
        throw new Error(
          "This file contains an invalid word. The current board has not changed.",
        );
      if (legacy && (tile.kind === "category" || "subBoardId" in tile))
        throw new Error(
          "A version-1 word cannot contain a category reference.",
        );
      if (!legacy && tile.kind !== "word" && tile.kind !== "category")
        throw new Error("This file contains an unsupported tile kind.");
      const fields: TileFields = {
        id: tile.id,
        label: tile.label.trim(),
        phrase: tile.phrase.trim(),
        icon: tile.icon,
        tone: tile.tone,
      };
      tileIds.add(tile.id);
      if (!legacy && tile.kind === "category") {
        if (child)
          throw new Error(
            "Only one category level is supported. Nested categories and cycles are not allowed.",
          );
        if (!validId(tile.subBoardId))
          throw new Error("This category is missing its board reference.");
        return { ...fields, kind: "category", subBoardId: tile.subBoardId };
      }
      if ("subBoardId" in tile)
        throw new Error("A word cannot reference a category board.");
      return { ...fields, kind: "word" };
    });
    return { tiles, size: isTileSize(page.size) ? page.size : "standard" };
  }
  const root = parsePage(value, false);
  const subBoards: SubBoard[] = [];
  const boardIds = new Set<string>();
  if (!legacy) {
    if (!Array.isArray(value.subBoards) || value.subBoards.length > 60)
      throw new Error(
        "This file needs a valid category-board list with at most 60 boards.",
      );
    for (const page of value.subBoards) {
      if (!record(page) || !validId(page.id) || boardIds.has(page.id))
        throw new Error(
          "This file contains an invalid or duplicate category-board ID.",
        );
      boardIds.add(page.id);
      subBoards.push({ id: page.id, ...parsePage(page, true) });
    }
  }
  const referenced = new Set<string>();
  for (const tile of root.tiles) {
    if (tile?.kind !== "category") continue;
    if (!boardIds.has(tile.subBoardId))
      throw new Error("This category refers to a missing board.");
    if (referenced.has(tile.subBoardId))
      throw new Error(
        "Each category board must belong to exactly one category.",
      );
    referenced.add(tile.subBoardId);
  }
  if (referenced.size !== subBoards.length)
    throw new Error("This file contains an orphan category board.");
  const board: Board = {
    version: 2,
    ...root,
    subBoards,
    voice: typeof value.voice === "string" ? value.voice : "",
    rate:
      typeof value.rate === "number" && value.rate >= 0.5 && value.rate <= 1.5
        ? value.rate
        : 0.85,
  };
  if (
    !legacy &&
    new TextEncoder().encode(JSON.stringify(board)).byteLength >
      maximumBoardBytes
  )
    throw new Error(
      "This board is too large to save or transfer. Keep the complete board under 99 KB.",
    );
  return board;
}
/** Validate canonical output before any write, including migrated legacy input. */
export function serializeBoard(board: Board): string {
  const serialized = JSON.stringify(parseBoard(board));
  if (new TextEncoder().encode(serialized).byteLength > maximumBoardBytes)
    throw new Error(
      "This board is too large to save or transfer. Keep the complete board under 99 KB.",
    );
  return serialized;
}
const vocabulary: [string, IconName, Tile["tone"]][] = [
  ["Yes", "check", "mint"],
  ["No", "x", "peach"],
  ["Stop", "hand", "peach"],
  ["Help", "circle-help", "blue"],
  ["More", "plus", "mint"],
  ["All done", "check", "lavender"],
  ["I want", "heart", "mint"],
  ["I don’t want", "minus", "peach"],
  ["Drink", "cup-soda", "blue"],
  ["Eat", "utensils", "peach"],
  ["Toilet", "toilet", "blue"],
  ["Break", "bed", "lavender"],
  ["Happy", "smile", "mint"],
  ["Sad", "frown", "lavender"],
  ["It hurts", "heart", "peach"],
  ["Go", "arrow-right", "mint"],
  ["Play", "play", "blue"],
  ["Together", "users", "lavender"],
  ["Listen", "ear", "blue"],
  ["Something else", "message-circle", "lavender"],
];
export function starterBoard(): Board {
  const tiles: (Tile | null)[] = vocabulary.map(([label, icon, tone], i) => ({
    kind: "word",
    id: `starter-${i}`,
    label,
    phrase: label,
    icon,
    tone,
  }));
  const drink = tiles[8];
  if (drink)
    tiles[8] = { ...drink, kind: "category", subBoardId: "starter-drinks" };
  return {
    version: 2,
    voice: "",
    rate: 0.85,
    size: "standard",
    tiles,
    subBoards: [
      {
        id: "starter-drinks",
        size: "standard",
        tiles: ["Water", "Milk", "Juice"].map((label, i) => ({
          kind: "word",
          id: `starter-drink-${i}`,
          label,
          phrase: label,
          icon: "cup-soda",
          tone: "blue",
        })),
      },
    ],
  };
}
export function boardPage(board: Board, id: string | null): BoardPage {
  return id === null
    ? board
    : (board.subBoards.find((page) => page.id === id) ?? board);
}
export function removeTile(board: Board, page: BoardPage, index: number): void {
  const tile = page.tiles[index];
  if (tile?.kind === "category")
    board.subBoards = board.subBoards.filter(
      (child) => child.id !== tile.subBoardId,
    );
  page.tiles[index] = null;
}
export function moveTile(
  tiles: (Tile | null)[],
  index: number,
  delta: number,
): (Tile | null)[] {
  const next = [...tiles];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length)
    return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
