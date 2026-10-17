import { parseBoard, type Board, type BoardPage } from "./board";

export type ArrangementTarget =
  { kind: "slot"; index: number } | { kind: "page"; pageId: string | null };
export type ArrangementResult =
  | { kind: "changed"; board: Board; message: string }
  | { kind: "unchanged"; message: string };

function pageAt(board: Board, id: string | null): BoardPage | undefined {
  return id === null ? board : board.subBoards.find((page) => page.id === id);
}

/** Transactional edits: invalid destinations never mutate the live board or draft. */
export function arrangeTile({
  board,
  pageId,
  tileId,
  target,
}: {
  board: Board;
  pageId: string | null;
  tileId: string;
  target: ArrangementTarget;
}): ArrangementResult {
  const next = structuredClone(board);
  const source = pageAt(next, pageId);
  const index = source?.tiles.findIndex((tile) => tile?.id === tileId) ?? -1;
  const tile = source?.tiles[index];
  if (!source || !tile)
    return { kind: "unchanged", message: "Choose a tile on this board." };
  if (target.kind === "slot") {
    if (
      !Number.isInteger(target.index) ||
      target.index < 0 ||
      target.index >= source.tiles.length
    )
      return {
        kind: "unchanged",
        message: "Choose a visible slot on this board.",
      };
    if (index === target.index)
      return { kind: "unchanged", message: "Tile is already in that slot." };
    const occupant = source.tiles[target.index];
    [source.tiles[index], source.tiles[target.index]] = [occupant, tile];
    return {
      kind: "changed",
      board: parseBoard(next),
      message: occupant
        ? `${tile.label} swapped with ${occupant.label}. Other slots stayed in place.`
        : `${tile.label} moved to slot ${target.index + 1}. Its previous slot is empty.`,
    };
  }
  if (target.pageId === pageId)
    return { kind: "unchanged", message: "Tile is already on that board." };
  if (tile.kind === "category")
    return {
      kind: "unchanged",
      message: "Categories stay on Home. Only words can move into a category.",
    };
  const destination = pageAt(next, target.pageId);
  if (!destination)
    return {
      kind: "unchanged",
      message: "That category is no longer available.",
    };
  let destinationIndex = destination.tiles.findIndex((item) => item === null);
  if (destinationIndex === -1) destinationIndex = destination.tiles.length;
  if (destinationIndex >= 60)
    return {
      kind: "unchanged",
      message: "That board has 60 filled slots. Make an empty slot first.",
    };
  destination.tiles[destinationIndex] = tile;
  source.tiles[index] = null;
  return {
    kind: "changed",
    board: parseBoard(next),
    message: `${tile.label} moved to ${target.pageId === null ? "Home" : (next.tiles.find((item) => item?.kind === "category" && item.subBoardId === target.pageId)?.label ?? "category")}, slot ${destinationIndex + 1}. Its previous slot is empty.`,
  };
}

export function createArrangementCategory(
  board: Board,
  label: string,
): ArrangementResult {
  const name = label.trim();
  if (!name || name.length > 40)
    return {
      kind: "unchanged",
      message: "Enter a category name from 1 to 40 characters.",
    };
  let index = board.tiles.findIndex((tile) => tile === null);
  if (index === -1) index = board.tiles.length;
  if (index >= 60)
    return {
      kind: "unchanged",
      message: "Home has 60 filled slots. Make an empty Home slot first.",
    };
  const next = structuredClone(board);
  const id = crypto.randomUUID();
  const subBoardId = crypto.randomUUID();
  next.tiles[index] = {
    kind: "category",
    id,
    subBoardId,
    label: name,
    phrase: name,
    icon: "book-open",
    tone: "blue",
  };
  next.subBoards.push({ id: subBoardId, size: board.size, tiles: [null] });
  return {
    kind: "changed",
    board: parseBoard(next),
    message: `${name} category created on Home, slot ${index + 1}.`,
  };
}
