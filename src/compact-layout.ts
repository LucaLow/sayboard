import { isTileSize, type TileSize } from "./layout";
import {
  isGridColumns,
  resolveColumns,
  type GridColumns,
} from "./device-layout";

export type DeviceTileSize = TileSize;
export type DeviceLayout = {
  columns: GridColumns;
  /** null keeps the imported/account board's size, without rewriting it. */
  size: DeviceTileSize | null;
};
export const deviceLayoutKey = "sayboard-device-layout-v1";

export function isDeviceTileSize(value: unknown): value is DeviceTileSize {
  return isTileSize(value);
}

/** Read local display preferences only; legacy geometry is migrated once. */
export function resolveDeviceLayout(
  saved: string | null,
  legacyColumns: string | null,
  width: number,
  boardSize: TileSize,
): DeviceLayout {
  if (saved !== null) {
    try {
      const value: unknown = JSON.parse(saved);
      if (
        typeof value === "object" &&
        value !== null &&
        "columns" in value &&
        typeof value.columns === "number" &&
        isGridColumns(value.columns) &&
        "size" in value &&
        (value.size === null || isDeviceTileSize(value.size))
      )
        return { columns: value.columns, size: value.size };
    } catch {
      // Invalid display data cannot invalidate or replace the saved board.
    }
  }
  return {
    columns: resolveColumns(legacyColumns, width, boardSize),
    size: null,
  };
}

/** Apply only when a caregiver explicitly chooses the preset and saves. */
export function compactPhoneLayout(): DeviceLayout {
  return { columns: 2, size: "small" };
}

export function isCompactPhoneLayout(layout: DeviceLayout): boolean {
  return layout.columns === 2 && layout.size === "small";
}

export function hasDeviceLayoutChanges(
  saved: DeviceLayout,
  draft: DeviceLayout,
): boolean {
  return saved.columns !== draft.columns || saved.size !== draft.size;
}
