import { describe, expect, it } from "vitest";
import {
  compactPhoneLayout,
  deviceLayoutKey,
  hasDeviceLayoutChanges,
  isDeviceTileSize,
  resolveDeviceLayout,
} from "../src/compact-layout";

describe("explicit device compact layout", () => {
  it("preserves existing geometry and board size until explicitly chosen", () => {
    for (const width of [320, 390, 768, 1024]) {
      expect(resolveDeviceLayout(null, "5", width, "extra-large")).toEqual({
        columns: 5,
        size: null,
      });
    }
    expect(resolveDeviceLayout(null, null, 390, "extra-large")).toEqual({
      columns: 1,
      size: null,
    });
  });

  it("keeps the saved phone preset fixed across rotation and reload", () => {
    const preference = compactPhoneLayout();
    for (const width of [320, 390, 844, 768, 1024]) {
      expect(
        resolveDeviceLayout(JSON.stringify(preference), "5", width, "large"),
      ).toEqual({ columns: 2, size: "small" });
    }
  });

  it("stores the preference outside either board version's storage key", () => {
    expect(deviceLayoutKey).not.toBe("sayboard-v1");
    expect(deviceLayoutKey).not.toBe("sayboard-v2");
  });

  it("rejects malformed display preferences without replacing saved geometry", () => {
    for (const invalid of [
      "{",
      "null",
      "[]",
      "1",
      '{"columns":0,"size":"small"}',
      '{"columns":2,"size":"tiny"}',
      '{"columns":"2","size":"small"}',
      '{"columns":2}',
      '{"columns":2,"size":false}',
    ]) {
      expect(resolveDeviceLayout(invalid, "3", 320, "large")).toEqual({
        columns: 3,
        size: null,
      });
    }
    expect(
      resolveDeviceLayout('{"columns":4,"size":null}', "2", 320, "large"),
    ).toEqual({ columns: 4, size: null });
  });

  it("detects local size-only and column-only draft changes", () => {
    const saved = { columns: 2, size: null } as const;
    expect(hasDeviceLayoutChanges(saved, { ...saved })).toBe(false);
    expect(hasDeviceLayoutChanges(saved, compactPhoneLayout())).toBe(true);
    expect(hasDeviceLayoutChanges(saved, { ...saved, columns: 3 })).toBe(true);
    for (const size of ["small", "standard", "large", "extra-large"])
      expect(isDeviceTileSize(size)).toBe(true);
    for (const size of ["tiny", "", {}, null, false])
      expect(isDeviceTileSize(size)).toBe(false);
  });
});
