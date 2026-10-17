import type { Board, BoardPage } from "./board";

function hasPageChanges(saved: BoardPage, working: BoardPage): boolean {
  return (
    saved.size !== working.size ||
    saved.tiles.length !== working.tiles.length ||
    saved.tiles.some((tile, index) => {
      const other = working.tiles[index];
      if (!tile || !other) return tile !== other;
      return (
        tile.kind !== other.kind ||
        tile.id !== other.id ||
        tile.label !== other.label ||
        tile.phrase !== other.phrase ||
        tile.icon !== other.icon ||
        tile.tone !== other.tone ||
        (tile.kind === "category" &&
          other.kind === "category" &&
          tile.subBoardId !== other.subBoardId)
      );
    })
  );
}

/** Compare meaning and stable slots. Child board order and object key order are immaterial. */
export function hasBoardChanges(saved: Board, working: Board): boolean {
  if (
    saved.version !== working.version ||
    saved.voice !== working.voice ||
    saved.rate !== working.rate ||
    hasPageChanges(saved, working) ||
    saved.subBoards.length !== working.subBoards.length
  )
    return true;

  const workingChildren = new Map(
    working.subBoards.map((child) => [child.id, child]),
  );
  return saved.subBoards.some((child) => {
    const other = workingChildren.get(child.id);
    return other === undefined || hasPageChanges(child, other);
  });
}
