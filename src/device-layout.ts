import type { TileSize } from "./layout";

export type GridColumns = 1 | 2 | 3 | 4 | 5;
export const columnsKey = "sayboard-device-columns";

export function isGridColumns(value: number): value is GridColumns {
  return (
    value === 1 || value === 2 || value === 3 || value === 4 || value === 5
  );
}

/** Pick a starting layout once. Only a deliberate caregiver change replaces it. */
export function resolveColumns(
  saved: string | null,
  width: number,
  size: TileSize = "standard",
): GridColumns {
  const value = Number(saved);
  if (saved !== null && isGridColumns(value)) return value;
  if (size === "extra-large") return width <= 540 ? 1 : width <= 900 ? 2 : 3;
  if (size === "large") return width <= 540 ? 2 : width <= 900 ? 3 : 4;
  return width <= 540 ? 2 : width <= 900 ? 4 : 5;
}
