import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteStore } from "../store.ts";
import { createApi } from "../api.ts";
import { DEVICE_MS, PAIRING_MS, SqliteClassrooms } from "../classroom-store.ts";
import { tokenHash } from "../password.ts";
import { starterBoard } from "../../src/board.ts";
import {
  record,
  text,
  parseClassroom,
  parseProfileDetail,
  parseDeviceBoard,
  parseDeviceSync,
} from "../../src/classroom-contract.ts";

const origin = "https://pilot.example.test";
const password = "synthetic-classroom-passphrase";
type Actor = { cookie: string; csrf: string };
let directory: string;
let store: SqliteStore;
let api: Awaited<ReturnType<typeof createApi>>;
let clock: number;
let teacher: Actor;
let other: Actor;
function request(
  path: string,
  method = "GET",
  payload?: unknown,
  actor?: Actor,
  extra: Record<string, string> = {},
) {
  return api(
    new Request(origin + path, {
      method,
      headers: {
        ...(method === "GET"
          ? {}
          : { origin, "content-type": "application/json" }),
        ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrf } : {}),
        ...extra,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    "synthetic-peer",
  );
}
function cookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}
async function login(username: string): Promise<Actor> {
  const response = await request("/api/auth/login", "POST", {
    username,
    password,
  });
  expect(response.status).toBe(200);
  return {
    cookie: cookie(response),
    csrf: text(record(await response.json()).csrfToken),
  };
}
async function fixture() {
  const room = parseClassroom(
    await (
      await request(
        "/api/classrooms",
        "POST",
        { name: "Demonstration classroom" },
        teacher,
      )
    ).json(),
  );
  const response = await request(
    `/api/classrooms/${room.id}/profiles`,
    "POST",
    { label: "Learner A" },
    teacher,
  );
  expect(response.status).toBe(201);
  return { room, profile: parseProfileDetail(await response.json()) };
}
async function code(profileId: string) {
  const response = await request(
    `/api/profiles/${profileId}/pairing`,
    "POST",
    { name: "Demonstration tablet" },
    teacher,
  );
  expect(response.status).toBe(200);
  return text(record(await response.json()).code);
}
async function pair(value: string): Promise<Actor> {
  const response = await request("/api/device/pair", "POST", { code: value });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toMatch(
    /Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/,
  );
  const device = { cookie: cookie(response), csrf: "" };
  const board = parseDeviceBoard(
    await (await request("/api/device/board", "GET", undefined, device)).json(),
  );
  return { ...device, csrf: board.csrfToken };
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "sayboard-classroom-"));
  store = new SqliteStore(join(directory, "data.sqlite"));
  await store.addAccount("teacher_one", password, false);
  await store.addAccount("teacher_two", password, false);
  clock = Date.now();
  api = await createApi(
    store,
    { kind: "hosted", origin, passwordConcurrency: 1 },
    () => clock,
  );
  teacher = await login("teacher_one");
  other = await login("teacher_two");
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("classroom ownership and publication", () => {
  it("deletes one adult's data and device access without affecting another adult", async () => {
    const { profile } = await fixture();
    const device = await pair(await code(profile.id));
    store.deleteAccount("teacher_one");
    expect(
      (await request("/api/auth/session", "GET", undefined, teacher)).status,
    ).toBe(401);
    expect(
      (await request("/api/device/board", "GET", undefined, device)).status,
    ).toBe(401);
    expect(await store.account("teacher_one")).toBeNull();
    expect(await store.account("teacher_two")).not.toBeNull();
    expect(
      (await request("/api/classrooms", "GET", undefined, other)).status,
    ).toBe(200);
    const db = new DatabaseSync(join(directory, "data.sqlite"));
    try {
      for (const table of [
        "classrooms",
        "classroom_profiles",
        "classroom_versions",
        "classroom_devices",
        "classroom_pairings",
      ])
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(
          0,
        );
    } finally {
      db.close();
    }
  });
  it("keeps every teacher operation scoped to the session owner", async () => {
    const { room, profile } = await fixture();
    expect(
      await (await request("/api/classrooms", "GET", undefined, other)).json(),
    ).toEqual({ classrooms: [] });
    const attempts: [string, string, unknown?][] = [
      [`/api/classrooms/${room.id}`, "GET"],
      [`/api/classrooms/${room.id}`, "DELETE"],
      [`/api/classrooms/${room.id}/profiles`, "POST", { label: "Not allowed" }],
      [`/api/profiles/${profile.id}`, "GET"],
      [
        `/api/profiles/${profile.id}`,
        "PUT",
        { revision: 1, board: starterBoard() },
      ],
      [`/api/profiles/${profile.id}`, "DELETE"],
      [`/api/profiles/${profile.id}/publish`, "POST", { revision: 1 }],
      [
        `/api/profiles/${profile.id}/restore`,
        "POST",
        { revision: 1, version: 1 },
      ],
      [
        `/api/profiles/${profile.id}/pairing`,
        "POST",
        { name: "Foreign device" },
      ],
    ];
    for (const [path, method, payload] of attempts) {
      const response = await request(path, method, payload, other);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(
      (await request(`/api/profiles/${profile.id}`, "GET", undefined, teacher))
        .status,
    ).toBe(200);
  });
  it("keeps drafts separate, rejects stale writes and makes publication retries idempotent", async () => {
    const { profile } = await fixture();
    const path = `/api/profiles/${profile.id}`;
    const device = await pair(await code(profile.id));
    expect(
      parseDeviceBoard(
        await (
          await request("/api/device/board", "GET", undefined, device)
        ).json(),
      ).board,
    ).toBeNull();
    const first = parseProfileDetail(
      await (
        await request(path + "/publish", "POST", { revision: 1 }, teacher)
      ).json(),
    );
    expect(first.publishedVersion).toBe(1);
    const retry = parseProfileDetail(
      await (
        await request(path + "/publish", "POST", { revision: 1 }, teacher)
      ).json(),
    );
    expect(retry.versions).toHaveLength(1);
    const changed = structuredClone(profile.board);
    if (changed.tiles[0]) changed.tiles[0].label = "Changed draft";
    expect(
      (await request(path, "PUT", { revision: 1, board: changed }, teacher))
        .status,
    ).toBe(200);
    expect(
      (
        await request(
          path,
          "PUT",
          { revision: 1, board: profile.board },
          teacher,
        )
      ).status,
    ).toBe(409);
    expect(
      (await request(path + "/publish", "POST", { revision: 1 }, teacher))
        .status,
    ).toBe(409);
    expect(
      parseDeviceBoard(
        await (
          await request("/api/device/board", "GET", undefined, device)
        ).json(),
      ).board,
    ).toEqual(profile.board);
    expect(
      (await request(path + "/publish", "POST", { revision: 2 }, teacher))
        .status,
    ).toBe(200);
    expect(
      parseDeviceBoard(
        await (
          await request("/api/device/board", "GET", undefined, device)
        ).json(),
      ).board,
    ).toEqual(changed);
    const restored = parseProfileDetail(
      await (
        await request(
          path + "/restore",
          "POST",
          { revision: 2, version: 1 },
          teacher,
        )
      ).json(),
    );
    expect(restored.board).toEqual(profile.board);
    expect(restored.publishedVersion).toBe(2);
    expect(
      parseDeviceBoard(
        await (
          await request("/api/device/board", "GET", undefined, device)
        ).json(),
      ).board,
    ).toEqual(changed);
    const published = parseProfileDetail(
      await (
        await request(
          path + "/publish",
          "POST",
          { revision: restored.revision },
          teacher,
        )
      ).json(),
    );
    expect(published.publishedVersion).toBe(3);
    expect(published.versions).toHaveLength(3);
  });
  it("rejects unauthenticated, foreign-origin, invalid JSON and missing-CSRF writes", async () => {
    const { room, profile } = await fixture();
    expect((await request("/api/classrooms")).status).toBe(401);
    expect(
      (
        await request(
          `/api/profiles/${profile.id}`,
          "PUT",
          { revision: 1, board: profile.board },
          { ...teacher, csrf: "" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/classrooms/${room.id}/profiles`,
          "POST",
          { label: "Rejected" },
          teacher,
          { origin: "https://foreign.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/profiles/${profile.id}`,
          "PUT",
          { revision: 1, board: { version: 999 } },
          teacher,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/api/profiles/${profile.id}/publish`,
          "GET",
          undefined,
          teacher,
        )
      ).status,
    ).toBe(405);
  });
  it("backs up classroom versions and restores them alongside accounts", async () => {
    const { room, profile } = await fixture();
    await request(
      `/api/profiles/${profile.id}/publish`,
      "POST",
      { revision: 1 },
      teacher,
    );
    await store.backup(join(directory, "snapshot.sqlite"));
    const restored = new SqliteStore(join(directory, "snapshot.sqlite"));
    try {
      const account = await restored.account("teacher_one");
      if (!account) throw new Error("Missing restored account");
      expect(
        restored.classrooms.detail(account.id, room.id).profiles,
      ).toHaveLength(1);
      expect(
        restored.classrooms.profile(account.id, profile.id).publishedVersion,
      ).toBe(1);
      expect(restored.classrooms.profile(account.id, profile.id).board).toEqual(
        profile.board,
      );
    } finally {
      restored.close();
    }
  });
});

describe("scoped classroom devices", () => {
  it("checks publication metadata without board content and reports only durable client receipts", async () => {
    const { profile } = await fixture();
    const device = await pair(await code(profile.id));
    const lastSeenAt = clock;
    const initial = await request("/api/device/sync", "GET", undefined, device);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(await initial.clone().json()).sort()).toEqual([
      "csrfToken",
      "label",
      "profileId",
      "version",
    ]);
    expect(parseDeviceSync(await initial.json()).version).toBe(0);
    const current = async () =>
      parseProfileDetail(
        await (
          await request(
            `/api/profiles/${profile.id}`,
            "GET",
            undefined,
            teacher,
          )
        ).json(),
      );
    expect((await current()).devices[0]).toMatchObject({
      appliedVersion: null,
      appliedAt: null,
      lastSeenAt: clock,
    });
    await request(
      `/api/profiles/${profile.id}/publish`,
      "POST",
      { revision: 1 },
      teacher,
    );
    clock += 1000;
    expect(
      parseDeviceSync(
        await (
          await request("/api/device/sync", "GET", undefined, device)
        ).json(),
      ).version,
    ).toBe(1);
    // Downloading is not a receipt: storage/application must finish on the client first.
    await request("/api/device/board", "GET", undefined, device);
    expect((await current()).devices[0].appliedVersion).toBeNull();
    expect(
      (await request("/api/device/applied", "POST", { version: 1 }, device))
        .status,
    ).toBe(200);
    const appliedAt = clock;
    clock += 1000;
    await request("/api/device/applied", "POST", { version: 1 }, device);
    expect((await current()).devices[0]).toMatchObject({
      appliedVersion: 1,
      appliedAt,
      lastSeenAt,
    });
    // Three-second polling must not produce a database write on every request.
    clock = lastSeenAt + 9_999;
    await request("/api/device/sync", "GET", undefined, device);
    expect((await current()).devices[0].lastSeenAt).toBe(lastSeenAt);
    clock = lastSeenAt + 10_000;
    await request("/api/device/sync", "GET", undefined, device);
    expect((await current()).devices[0]).toMatchObject({
      appliedVersion: 1,
      appliedAt,
      lastSeenAt: clock,
    });
  });
  it("rejects invalid receipts and isolates each device, profile and teacher", async () => {
    const { profile } = await fixture();
    const one = await pair(await code(profile.id));
    const two = await pair(await code(profile.id));
    for (const version of [0, 1, -1, 1.5, "1", null])
      expect(
        (await request("/api/device/applied", "POST", { version }, one)).status,
      ).toBe(400);
    await request(
      `/api/profiles/${profile.id}/publish`,
      "POST",
      { revision: 1 },
      teacher,
    );
    expect(
      (
        await request(
          "/api/device/applied",
          "POST",
          { version: 1 },
          { ...one, csrf: "" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/device/applied", "POST", { version: 1 }, one, {
          origin: "https://foreign.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await request("/api/device/applied", "POST", { version: 1 }, teacher))
        .status,
    ).toBe(401);
    expect(
      (await request("/api/device/applied", "POST", { version: 2 }, one))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          "/api/device/applied?profile=other",
          "POST",
          { version: 1 },
          one,
        )
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/device/applied", "GET", undefined, one)).status,
    ).toBe(405);
    expect((await request("/api/device/sync", "POST", {}, one)).status).toBe(
      405,
    );
    expect(
      (await request("/api/device/applied", "POST", { version: 1 }, one))
        .status,
    ).toBe(200);
    const devices = parseProfileDetail(
      await (
        await request(`/api/profiles/${profile.id}`, "GET", undefined, teacher)
      ).json(),
    ).devices;
    expect(devices.map((d) => d.appliedVersion)).toEqual([1, null]);
    expect(
      parseDeviceSync(
        await (await request("/api/device/sync", "GET", undefined, two)).json(),
      ).profileId,
    ).toBe(profile.id);
  });
  it("keeps receipt versions monotonic when delayed requests arrive after a newer publication", async () => {
    const { profile } = await fixture();
    const device = await pair(await code(profile.id));
    await request(
      `/api/profiles/${profile.id}/publish`,
      "POST",
      { revision: 1 },
      teacher,
    );
    const changed = structuredClone(profile.board);
    if (changed.tiles[0]) changed.tiles[0].label = "A newer publication";
    await request(
      `/api/profiles/${profile.id}`,
      "PUT",
      { revision: 1, board: changed },
      teacher,
    );
    await request(
      `/api/profiles/${profile.id}/publish`,
      "POST",
      { revision: 2 },
      teacher,
    );
    expect(
      (await request("/api/device/applied", "POST", { version: 2 }, device))
        .status,
    ).toBe(200);
    const appliedAt = clock;
    clock += 10_000;
    expect(
      (await request("/api/device/applied", "POST", { version: 1 }, device))
        .status,
    ).toBe(200);
    const detail = parseProfileDetail(
      await (
        await request(`/api/profiles/${profile.id}`, "GET", undefined, teacher)
      ).json(),
    );
    expect(detail.devices[0]).toMatchObject({
      appliedVersion: 2,
      appliedAt,
      lastSeenAt: clock,
    });
  });
  it("rejects sync and receipts after revocation or expiry, preserving receipts in backups", async () => {
    const { profile } = await fixture();
    const device = await pair(await code(profile.id));
    await request(
      `/api/profiles/${profile.id}/publish`,
      "POST",
      { revision: 1 },
      teacher,
    );
    await request("/api/device/applied", "POST", { version: 1 }, device);
    await store.backup(join(directory, "receipt.sqlite"));
    const restored = new SqliteStore(join(directory, "receipt.sqlite"));
    try {
      const account = await restored.account("teacher_one");
      if (!account) throw new Error("Missing restored account");
      expect(
        restored.classrooms.profile(account.id, profile.id).devices[0],
      ).toMatchObject({
        appliedVersion: 1,
        appliedAt: clock,
        lastSeenAt: clock,
      });
    } finally {
      restored.close();
    }
    await request("/api/device/unlink", "POST", {}, device);
    expect(
      (await request("/api/device/sync", "GET", undefined, device)).status,
    ).toBe(401);
    expect(
      (await request("/api/device/applied", "POST", { version: 1 }, device))
        .status,
    ).toBe(401);
    const expiring = await pair(await code(profile.id));
    clock += DEVICE_MS + 1;
    expect(
      (await request("/api/device/sync", "GET", undefined, expiring)).status,
    ).toBe(401);
    expect(
      (await request("/api/device/applied", "POST", { version: 1 }, expiring))
        .status,
    ).toBe(401);
  });
  it("migrates legacy paired devices additively and accepts new pairs after repeated startup", async () => {
    const { profile } = await fixture();
    const device = await pair(await code(profile.id));
    const db = new DatabaseSync(join(directory, "data.sqlite"));
    try {
      for (const column of ["applied_version", "applied_at", "last_seen_at"])
        db.exec(`ALTER TABLE classroom_devices DROP COLUMN ${column}`);
      new SqliteClassrooms(db);
      new SqliteClassrooms(db);
      expect(
        parseDeviceSync(
          await (
            await request("/api/device/sync", "GET", undefined, device)
          ).json(),
        ).profileId,
      ).toBe(profile.id);
      const next = await pair(await code(profile.id));
      expect(
        (await request("/api/device/sync", "GET", undefined, next)).status,
      ).toBe(200);
      expect(
        db.prepare("SELECT count(*) AS n FROM classroom_devices").get()?.n,
      ).toBe(2);
    } finally {
      db.close();
    }
  });
  it("stores only credential hashes and atomically consumes a pairing code once", async () => {
    const { profile } = await fixture();
    const value = await code(profile.id);
    const replies = await Promise.all([
      request("/api/device/pair", "POST", { code: value }),
      request("/api/device/pair", "POST", { code: value }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 401]);
    const accepted = replies.find((r) => r.status === 200);
    if (!accepted) throw new Error("Pairing failed");
    const db = new DatabaseSync(join(directory, "data.sqlite"));
    try {
      expect(
        db.prepare("SELECT count(*) AS count FROM classroom_pairings").get()
          ?.count,
      ).toBe(0);
      const raw = cookie(accepted).split("=")[1];
      expect(
        db.prepare("SELECT token_hash FROM classroom_devices").get()
          ?.token_hash,
      ).toBe(tokenHash(raw));
      expect(
        db.prepare("SELECT token_hash FROM classroom_devices").get()
          ?.token_hash,
      ).not.toBe(raw);
    } finally {
      db.close();
    }
  });
  it("rejects expired pairing codes, cross-origin pairing and guessing", async () => {
    const { profile } = await fixture();
    const value = await code(profile.id);
    expect(
      (
        await request("/api/device/pair", "POST", { code: value }, undefined, {
          origin: "https://foreign.example",
        })
      ).status,
    ).toBe(403);
    clock += PAIRING_MS + 1;
    expect(
      (await request("/api/device/pair", "POST", { code: value })).status,
    ).toBe(401);
    for (let i = 0; i < 9; i++)
      expect(
        (await request("/api/device/pair", "POST", { code: "0000000000" }))
          .status,
      ).toBe(401);
    expect(
      (await request("/api/device/pair", "POST", { code: "0000000000" }))
        .status,
    ).toBe(429);
  });
  it("cannot use a device credential to access teacher data or change assignments", async () => {
    const { profile } = await fixture();
    const device = await pair(await code(profile.id));
    expect(
      (await request("/api/classrooms", "GET", undefined, device)).status,
    ).toBe(401);
    expect(
      (
        await request(
          `/api/profiles/${profile.id}`,
          "PUT",
          { revision: 1, board: starterBoard() },
          device,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/device/board?profile=other",
          "GET",
          undefined,
          device,
        )
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/device/unlink", "POST", {}, { ...device, csrf: "" }))
        .status,
    ).toBe(403);
    expect(
      (await request("/api/device/unlink", "POST", {}, device)).status,
    ).toBe(200);
    expect(
      (await request("/api/device/board", "GET", undefined, device)).status,
    ).toBe(401);
  });
  it("revokes only the intended profile's device and expires long-lived links", async () => {
    const { room, profile } = await fixture();
    const device = await pair(await code(profile.id));
    const detail = parseProfileDetail(
      await (
        await request(`/api/profiles/${profile.id}`, "GET", undefined, teacher)
      ).json(),
    );
    expect(detail.devices).toHaveLength(1);
    const another = parseProfileDetail(
      await (
        await request(
          `/api/classrooms/${room.id}/profiles`,
          "POST",
          { label: "Learner B" },
          teacher,
        )
      ).json(),
    );
    expect(
      (
        await request(
          `/api/profiles/${another.id}/devices/${detail.devices[0].id}`,
          "DELETE",
          undefined,
          teacher,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/profiles/${profile.id}/devices/${detail.devices[0].id}`,
          "DELETE",
          undefined,
          other,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/profiles/${profile.id}/devices/${detail.devices[0].id}`,
          "DELETE",
          undefined,
          teacher,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/device/board", "GET", undefined, device)).status,
    ).toBe(401);
    const expiring = await pair(await code(another.id));
    clock += DEVICE_MS + 1;
    expect(
      (await request("/api/device/board", "GET", undefined, expiring)).status,
    ).toBe(401);
  });
  it("removes versions and device access when a teacher deletes a classroom", async () => {
    const { room, profile } = await fixture();
    await request(
      `/api/profiles/${profile.id}/publish`,
      "POST",
      { revision: 1 },
      teacher,
    );
    const device = await pair(await code(profile.id));
    expect(
      (
        await request(
          `/api/classrooms/${room.id}`,
          "DELETE",
          undefined,
          teacher,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request(`/api/profiles/${profile.id}`, "GET", undefined, teacher))
        .status,
    ).toBe(404);
    expect(
      (await request("/api/device/board", "GET", undefined, device)).status,
    ).toBe(401);
    const db = new DatabaseSync(join(directory, "data.sqlite"));
    try {
      for (const table of [
        "classroom_profiles",
        "classroom_versions",
        "classroom_devices",
        "classroom_pairings",
      ])
        expect(
          db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count,
        ).toBe(0);
    } finally {
      db.close();
    }
  });
});
