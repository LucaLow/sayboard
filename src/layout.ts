export type TileSize = "small" | "standard" | "large" | "extra-large";

export function isTileSize(value: unknown): value is TileSize {
  return (
    value === "small" ||
    value === "standard" ||
    value === "large" ||
    value === "extra-large"
  );
}

export const maximumSlots = 60;

export type PlacementResult<T> =
  | { kind: "placed"; tiles: (T | null)[] }
  | { kind: "occupied"; occupant: T }
  | { kind: "invalid"; message: string };

/** Index is a zero-based stable slot. Moving leaves a gap and never displaces a word. */
export function placeTile<T extends { id: string }>(
  tiles: readonly (T | null)[],
  index: number,
  tile: T,
): PlacementResult<T> {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= maximumSlots ||
    tiles.length > maximumSlots
  ) {
    return { kind: "invalid", message: "Choose a position from 1 to 60." };
  }
  const occupant = tiles[index];
  if (occupant && occupant.id !== tile.id) {
    return { kind: "occupied", occupant };
  }
  const next = tiles.map((existing) =>
    existing?.id === tile.id ? null : existing,
  );
  while (next.length <= index) next.push(null);
  next[index] = tile;
  return { kind: "placed", tiles: next };
}
