import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { starterBoard } from "../src/board";
import { ClassroomError } from "../src/classroom-client";
import { createClassroomSync, classroomLinkKey } from "../src/classroom-sync";
import type { DeviceBoard, DeviceSync } from "../src/classroom-contract";

const profileId = "ac860f41-f706-4359-8cb8-2c71d8adb24e";
const csrfToken = "a".repeat(64);
function metadata(version = 1): DeviceSync {
  return { profileId, label: "Learner board", version, csrfToken };
}
function publication(version = 1): DeviceBoard {
  return { ...metadata(version), board: starterBoard() };
}
function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!complete) throw new Error("Deferred response not initialized");
      complete(value);
    },
  };
}
let browser: EventTarget;
let page: EventTarget & { visibilityState: string; cookie: string };
const running: ReturnType<typeof createClassroomSync>[] = [];
function fixture({
  linkedVersion,
  serverHint = false,
  hasStoredBoard = true,
}: {
  linkedVersion?: number;
  serverHint?: boolean;
  hasStoredBoard?: boolean;
} = {}) {
  const values = new Map<string, string>();
  if (linkedVersion !== undefined)
    values.set(
      classroomLinkKey,
      JSON.stringify({ profileId, version: linkedVersion }),
    );
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const client = {
    sync: vi.fn<() => Promise<DeviceSync>>().mockResolvedValue(metadata()),
    board: vi.fn<() => Promise<DeviceBoard>>().mockResolvedValue(publication()),
    applied: vi
      .fn<(version: number, csrf: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const canApply = vi.fn(() => true);
  const apply = vi.fn<(_: DeviceBoard) => boolean>(() => true);
  const onState = vi.fn();
  const controller = createClassroomSync({
    storage,
    serverHint,
    hasStoredBoard,
    canApply,
    apply,
    onState,
    client,
  });
  running.push(controller);
  return { values, storage, client, canApply, apply, onState, controller };
}
beforeEach(() => {
  vi.useFakeTimers();
  browser = new EventTarget();
  page = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    cookie: "",
  });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", page);
});
afterEach(() => {
  running.splice(0).forEach((controller) => controller.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("automatic classroom synchronization", () => {
  it("makes no classroom requests for an unlinked free board, including browser wake-up events", async () => {
    const { client, apply, controller } = fixture({ hasStoredBoard: false });
    browser.dispatchEvent(new Event("online"));
    browser.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.sync).not.toHaveBeenCalled();
    expect(client.board).not.toHaveBeenCalled();
    expect(client.applied).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(controller.state()).toEqual({ kind: "unlinked" });
  });
  it("waits through an active interaction and automatically applies when it becomes safe", async () => {
    const { client, canApply, apply, controller } = fixture({
      linkedVersion: 0,
    });
    canApply.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state()).toMatchObject({
      kind: "linked",
      status: "waiting",
      version: 0,
    });
    expect(apply).not.toHaveBeenCalled();
    expect(client.applied).not.toHaveBeenCalled();
    canApply.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(apply).toHaveBeenCalledExactlyOnceWith(publication());
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(1, csrfToken);
    expect(controller.state()).toMatchObject({ status: "current", version: 1 });
  });
  it("discards a publication superseded while its download is in flight", async () => {
    const { client, apply } = fixture({ linkedVersion: 0 });
    const download = deferred<DeviceBoard>();
    client.sync
      .mockResolvedValueOnce(metadata(1))
      .mockResolvedValue(metadata(2));
    client.board
      .mockResolvedValue(publication(2))
      .mockImplementationOnce(() => download.promise);
    await vi.advanceTimersByTimeAsync(0);
    download.resolve(publication(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    expect(client.applied).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(apply).toHaveBeenCalledExactlyOnceWith(publication(2));
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(2, csrfToken);
  });
  it("rechecks a publication after download and rejects a stale confirmation", async () => {
    const { client, apply } = fixture({ linkedVersion: 0 });
    const confirmation = deferred<DeviceSync>();
    client.sync
      .mockResolvedValue(metadata(2))
      .mockResolvedValueOnce(metadata(1))
      .mockImplementationOnce(() => confirmation.promise);
    client.board
      .mockResolvedValueOnce(publication(1))
      .mockResolvedValue(publication(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.sync).toHaveBeenCalledTimes(2);
    confirmation.resolve(metadata(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(apply).toHaveBeenCalledExactlyOnceWith(publication(2));
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(2, csrfToken);
  });
  it("checks interaction safety again after awaiting confirmation", async () => {
    const { client, canApply, apply } = fixture({ linkedVersion: 0 });
    const confirmation = deferred<DeviceSync>();
    client.sync
      .mockResolvedValue(metadata())
      .mockResolvedValueOnce(metadata())
      .mockImplementationOnce(() => confirmation.promise);
    await vi.advanceTimersByTimeAsync(0);
    canApply.mockReturnValue(false);
    confirmation.resolve(metadata());
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    expect(client.applied).not.toHaveBeenCalled();
    canApply.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(client.applied).toHaveBeenCalledTimes(1);
  });
  it("never acknowledges an apply failure and retries automatically", async () => {
    const { client, apply, controller } = fixture({ linkedVersion: 0 });
    apply.mockReturnValueOnce(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state()).toMatchObject({
      status: "storage-error",
      version: 0,
    });
    expect(client.applied).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(1, csrfToken);
    expect(controller.state()).toMatchObject({ status: "current", version: 1 });
  });
  it("never acknowledges a failed version-marker write after saving the board", async () => {
    const { storage, client, apply, controller } = fixture({
      linkedVersion: 0,
    });
    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException("Full storage", "QuotaExceededError");
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(client.applied).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({
      status: "storage-error",
      version: 0,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(1, csrfToken);
  });
  it("retries a failed receipt without downloading or applying the durable board again", async () => {
    const { client, apply, controller } = fixture({ linkedVersion: 0 });
    client.applied.mockRejectedValueOnce(
      new ClassroomError(0, "Synthetic network outage"),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state()).toMatchObject({ status: "offline", version: 1 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.applied).toHaveBeenCalledTimes(2);
    expect(client.board).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(controller.state()).toMatchObject({ status: "current", version: 1 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.applied).toHaveBeenCalledTimes(2);
  });
  it("stops after revocation while preserving the last working board", async () => {
    const { values, client, apply, controller } = fixture({ linkedVersion: 1 });
    values.set("sayboard-board-v2", "saved communication board");
    client.sync.mockRejectedValueOnce(
      new ClassroomError(401, "Device revoked"),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state()).toEqual({ kind: "unlinked" });
    expect(values.get("sayboard-board-v2")).toBe("saved communication board");
    expect(values.has(classroomLinkKey)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    browser.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.sync).toHaveBeenCalledTimes(1);
  });
  it("restores a missing saved board even when its version marker says it is current", async () => {
    const { client, apply, controller } = fixture({
      linkedVersion: 1,
      hasStoredBoard: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.board).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledExactlyOnceWith(publication());
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(1, csrfToken);
    expect(controller.state()).toMatchObject({ status: "current", version: 1 });
  });
  it("uses the legacy server hint to recover a binding without a saved version marker", async () => {
    const { client, apply, values } = fixture({ serverHint: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(publication());
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(1, csrfToken);
    expect(JSON.parse(values.get(classroomLinkKey) ?? "null")).toEqual({
      profileId,
      version: 1,
    });
  });
  it("rejects an in-flight download when access is revoked before its confirmation", async () => {
    const { client, apply, controller } = fixture({ linkedVersion: 0 });
    const download = deferred<DeviceBoard>();
    client.board.mockImplementationOnce(() => download.promise);
    client.sync
      .mockResolvedValueOnce(metadata())
      .mockRejectedValueOnce(new ClassroomError(401, "Device revoked"));
    await vi.advanceTimersByTimeAsync(0);
    download.resolve(publication());
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state()).toEqual({ kind: "unlinked" });
    expect(apply).not.toHaveBeenCalled();
    expect(client.applied).not.toHaveBeenCalled();
  });
  it("invalidates an old download when this browser is paired to another profile", async () => {
    const { client, apply, controller } = fixture({ linkedVersion: 0 });
    const download = deferred<DeviceBoard>();
    client.board.mockImplementationOnce(() => download.promise);
    await vi.advanceTimersByTimeAsync(0);
    const next = {
      ...metadata(),
      profileId: "67408175-e843-4bcf-b98b-3e86d0c1f650",
    };
    const nextBoard = { ...next, board: starterBoard() };
    client.sync.mockResolvedValue(next);
    client.board.mockResolvedValue(nextBoard);
    controller.connect(next);
    download.resolve(publication());
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(nextBoard);
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(1, csrfToken);
  });
  it("keeps the working board through an outage and catches up when connectivity returns", async () => {
    const { values, client, apply, controller } = fixture({ linkedVersion: 1 });
    values.set("sayboard-board-v2", "saved communication board");
    client.sync
      .mockRejectedValueOnce(new ClassroomError(0, "Synthetic offline device"))
      .mockResolvedValue(metadata(2));
    client.board.mockResolvedValue(publication(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state()).toMatchObject({ status: "offline", version: 1 });
    expect(values.get("sayboard-board-v2")).toBe("saved communication board");
    expect(apply).not.toHaveBeenCalled();
    browser.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(publication(2));
    expect(client.applied).toHaveBeenCalledExactlyOnceWith(2, csrfToken);
  });
});
