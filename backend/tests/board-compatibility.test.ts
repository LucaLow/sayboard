import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { SqliteStore } from "../store.ts";
import { PostgresStore } from "../postgres-store.ts";
import { createApi, MAX_BODY_BYTES } from "../api.ts";
import { createHostedHandler as rawHostedHandler } from "../hosted.ts";
function createHostedHandler(...args: Parameters<typeof rawHostedHandler>) { const handler = rawHostedHandler(...args); return (request: Request) => handler(request, "203.0.113.10"); }
import { localConfig } from "../config.ts";
import { hashPassword, newToken, tokenHash, csrfToken } from "../password.ts";
import { parseBoard, starterBoard } from "../../src/board.ts";
import { catalogue } from "../../src/catalogue.ts";
import type { Store } from "../store-contract.ts";

// Exercise the same shared parser as the merged frontend, not a copied schema.
const directory = mkdtempSync(join(tmpdir(), "sayboard-compatibility-"));
const localPath = join(directory, "synthetic.sqlite");
const local = new SqliteStore(localPath);
const postgres = new PGlite();
const hosted = new PostgresStore((sql, params) => postgres.query(sql, params));
const localSettings = localConfig({
  NODE_ENV: "development",
  SAYBOARD_LOCAL_DEV: "1",
});
const hostedOrigin = "https://sayboard.example.test";
const hostedOwner = randomUUID();
type Fixture = {
  name: string;
  store: Store;
  owner: string;
  origin: string;
  cookie: string;
  csrf: string;
  send: (request: Request) => Promise<Response>;
};
const fixtures: Fixture[] = [];
beforeAll(async () => {
  await local.seedLocalAdmin();
  const localOwner = (await local.account("admin"))!.id;
  await postgres.exec(
    readFileSync(
      new URL("../migrations/001_postgres.sql", import.meta.url),
      "utf8",
    ),
  );
  await postgres.exec(
    readFileSync(
      new URL("../migrations/002_board_categories.sql", import.meta.url),
      "utf8",
    ),
  );
  await postgres.query(
    "INSERT INTO sayboard.accounts(id,username,password_hash) VALUES ($1,'synthetic',$2)",
    [hostedOwner, await hashPassword("synthetic-test-password-only")],
  );
  const localApi = await createApi(local, localSettings, () => 1000);
  const hostedApi = createHostedHandler(
    {
      NODE_ENV: "production",
      SAYBOARD_AUTH_ENABLED: "1",
      SAYBOARD_STORAGE: "postgres",
      SAYBOARD_ORIGIN: hostedOrigin,
      DATABASE_URL: "postgresql://synthetic:unused@db.example.test/synthetic",
    },
    async () => hosted,
    () => 1000,
  );
  for (const fixture of [
    {
      name: "local SQLite API",
      store: local,
      owner: localOwner,
      origin: localSettings.origin,
      cookieName: "sayboard_session",
      send: (request: Request) => localApi(request, "127.0.0.1"),
    },
    {
      name: "hosted PostgreSQL API",
      store: hosted,
      owner: hostedOwner,
      origin: hostedOrigin,
      cookieName: "__Host-sayboard_session",
      send: hostedApi,
    },
  ]) {
    const token = newToken();
    await fixture.store.createSession(tokenHash(token), fixture.owner, 10_000);
    fixtures.push({
      ...fixture,
      cookie: `${fixture.cookieName}=${token}`,
      csrf: csrfToken(token),
    });
  }
}, 20_000);
afterAll(async () => {
  local.close();
  await postgres.close();
  rmSync(directory, { recursive: true, force: true });
});

function request(fixture: Fixture, method: string, body?: unknown) {
  return new Request(`${fixture.origin}/api/board`, {
    method,
    headers: {
      origin: fixture.origin,
      cookie: fixture.cookie,
      "x-csrf-token": fixture.csrf,
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function board(size: "small" | "standard" | "large" | "extra-large") {
  const base = starterBoard();
  return {
    ...base,
    subBoards: [],
    size,
    voice: "synthetic-voice-id",
    rate: 1.25,
    tiles: [
      {
        ...base.tiles[0]!,
        id: "stable-emoji",
        icon: "emoji:1f34e",
        label: "Apple",
        phrase: "I want an apple",
      },
      null,
      {
        ...base.tiles[1]!,
        id: "stable-lucide",
        icon: "stethoscope",
        label: "Doctor",
        phrase: "I need the doctor",
      },
      null,
    ],
  };
}
async function save(fixture: Fixture, value: unknown) {
  const previous = await fixture.store.board(fixture.owner);
  return fixture.send(
    request(fixture, "PUT", {
      board: value,
      revision: previous?.revision ?? 0,
    }),
  );
}

for (const name of ["local SQLite API", "hosted PostgreSQL API"]) {
  describe(`${name}: stage-two board compatibility`, () => {
    for (const size of ["small", "standard", "large", "extra-large"] as const) {
      it(`round-trips ${size}, emoji/Lucide IDs, gaps, stable IDs and speech settings`, async () => {
        const fixture = fixtures.find((entry) => entry.name === name)!;
        const expected = board(size);
        const response = await save(fixture, expected);
        expect(response.status).toBe(200);
        const saved = await response.json();
        expect(saved).toEqual({
          board: expected,
          revision: expect.any(Number),
        });
        expect(
          await (await fixture.send(request(fixture, "GET"))).json(),
        ).toEqual(saved);
        expect(await fixture.store.board(fixture.owner)).toEqual(saved);
      });
    }
    it("defaults legacy version-1 boards to standard while retaining their data", async () => {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      const legacy: unknown = JSON.parse(
        readFileSync(
          new URL(
            "../../tests/fixtures/legacy-custom-board.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      if (typeof legacy !== "object" || legacy === null)
        throw new Error("Invalid fixture");
      const preSize = Object.fromEntries(Object.entries(legacy));
      delete preSize.size;
      const current = parseBoard(preSize);
      expect(current.size).toBe("standard");
      const response = await save(fixture, preSize);
      expect(response.status).toBe(200);
      const saved = await response.json();
      expect(saved.board).toEqual(current);
      // Existing pre-stage-two rows lack size, too; verify reads without rewriting
      // their payload or revision, using actual persisted legacy JSON.
      if (fixture.store === local) {
        const connection = new DatabaseSync(localPath);
        try {
          connection
            .prepare("UPDATE boards SET payload = ? WHERE account_id = ?")
            .run(JSON.stringify(preSize), fixture.owner);
        } finally {
          connection.close();
        }
      } else {
        await postgres.query(
          "UPDATE sayboard.boards SET payload = $1::jsonb WHERE account_id = $2",
          [JSON.stringify(preSize), fixture.owner],
        );
      }
      expect(await fixture.store.board(fixture.owner)).toEqual({
        board: current,
        revision: saved.revision,
      });
      expect(
        (await (await fixture.send(request(fixture, "GET"))).json()).board,
      ).toEqual(current);
      if (fixture.store === local) {
        const connection = new DatabaseSync(localPath);
        try {
          expect(
            connection
              .prepare(
                "SELECT payload, revision FROM boards WHERE account_id = ?",
              )
              .get(fixture.owner),
          ).toEqual({
            payload: JSON.stringify(preSize),
            revision: saved.revision,
          });
        } finally {
          connection.close();
        }
      } else {
        expect(
          (
            await postgres.query(
              "SELECT payload, revision FROM sayboard.boards WHERE account_id = $1",
              [fixture.owner],
            )
          ).rows,
        ).toEqual([{ payload: preSize, revision: saved.revision }]);
      }
    });
    it("rejects unknown sizes or unsafe symbol IDs without changing the saved board", async () => {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      const previous = await fixture.store.board(fixture.owner);
      const valid = board("large");
      const invalid = [
        { ...valid, size: "gigantic" },
        { ...valid, size: null },
        ...[
          "emoji:ffffffff",
          "emoji:<script>",
          "javascript:alert(1)",
          "https://example.test/icon.svg",
          "<svg onload=alert(1)>",
        ].map((icon) => ({ ...valid, tiles: [{ ...valid.tiles[0]!, icon }] })),
      ];
      for (const value of invalid) {
        expect((await save(fixture, value)).status).toBe(400);
        expect(await fixture.store.board(fixture.owner)).toEqual(previous);
      }
    });
    it("preserves all 60 slots with leading and trailing gaps", async () => {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      const valid = board("extra-large");
      const expected = {
        ...valid,
        tiles: Array.from({ length: 60 }, (_, index) =>
          index === 42 ? valid.tiles[0] : null,
        ),
      };
      const response = await save(fixture, expected);
      expect(response.status).toBe(200);
      expect((await response.json()).board).toEqual(expected);
      expect(
        (await save(fixture, { ...expected, tiles: [...expected.tiles, null] }))
          .status,
      ).toBe(400);
      expect((await fixture.store.board(fixture.owner))?.board).toEqual(
        expected,
      );
    });
    it("round-trips the complete category hierarchy through API and storage", async () => {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      const expected = starterBoard();
      expected.size = "extra-large";
      expected.voice = "synthetic-unavailable-voice";
      expected.rate = 1.3;
      expected.tiles = [null, ...expected.tiles, null];
      for (const child of expected.subBoards) {
        child.size = "small";
        child.tiles = [null, ...child.tiles, null];
      }
      expect(expected.subBoards).toHaveLength(1);
      const response = await save(fixture, expected);
      expect(response.status).toBe(200);
      const saved = await response.json();
      expect(saved).toEqual({ board: expected, revision: expect.any(Number) });
      expect(await fixture.store.board(fixture.owner)).toEqual(saved);
      expect(
        await (await fixture.send(request(fixture, "GET"))).json(),
      ).toEqual(saved);
    });

    it("preserves hierarchy and revision after stale, invalid graph and oversized UTF-8 writes", async () => {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      const response = await save(fixture, starterBoard());
      expect(response.status).toBe(200);
      const previous = await fixture.store.board(fixture.owner);
      if (!previous) throw new Error("Expected saved synthetic board");
      const stale = await fixture.send(
        request(fixture, "PUT", {
          board: { ...previous.board, voice: "stale" },
          revision: previous.revision - 1,
        }),
      );
      expect(stale.status).toBe(409);
      expect(await fixture.store.board(fixture.owner)).toEqual(previous);
      const category = previous.board.tiles.find(
        (tile) => tile?.kind === "category",
      );
      if (category?.kind !== "category")
        throw new Error("Missing category fixture");
      const child = previous.board.subBoards[0];
      const invalid = [
        { ...previous.board, subBoards: [] },
        { ...previous.board, tiles: [null] },
        {
          ...previous.board,
          tiles: [category, { ...category, id: "second-owner" }],
        },
        { ...previous.board, subBoards: [child, child] },
        {
          ...previous.board,
          subBoards: [{ ...child, tiles: [{ ...category, id: "cycle" }] }],
        },
        { ...previous.board, version: 1 },
      ];
      for (const value of invalid) {
        expect((await save(fixture, value)).status).toBe(400);
        expect(await fixture.store.board(fixture.owner)).toEqual(previous);
      }
      const oversized = { ...previous.board, voice: "日".repeat(35_000) };
      const envelope = JSON.stringify({
        board: oversized,
        revision: previous.revision,
      });
      expect(envelope.length).toBeLessThan(MAX_BODY_BYTES);
      expect(new TextEncoder().encode(envelope).byteLength).toBeGreaterThan(
        MAX_BODY_BYTES,
      );
      expect((await save(fixture, oversized)).status).toBe(413);
      expect(await fixture.store.board(fixture.owner)).toEqual(previous);
    });

    it("validates direct-store writes before replacing the saved payload", async () => {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      expect((await save(fixture, starterBoard())).status).toBe(200);
      const previous = await fixture.store.board(fixture.owner);
      if (!previous) throw new Error("Expected saved synthetic board");
      for (const invalid of [
        { ...previous.board, subBoards: [] },
        { ...previous.board, voice: "日".repeat(35_000) },
      ]) {
        await expect(
          fixture.store.saveBoard(fixture.owner, invalid, previous.revision),
        ).rejects.toThrow();
        expect(await fixture.store.board(fixture.owner)).toEqual(previous);
      }
    });

    it("rejects oversized runtime v1 saves before changing raw payload or revision", async () => {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      expect((await save(fixture, starterBoard())).status).toBe(200);
      const previous = await fixture.store.board(fixture.owner);
      if (!previous) throw new Error("Expected saved synthetic board");
      const source: unknown = JSON.parse(
        readFileSync(
          new URL(
            "../../tests/fixtures/legacy-custom-board.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      if (typeof source !== "object" || source === null)
        throw new Error("Invalid legacy fixture");
      const oversized = { ...source, voice: "日".repeat(35_000) };
      // Legacy reads deliberately remain permissive. Writes must recheck the
      // migrated serialization before executing SQL, even for runtime v1 input.
      expect(parseBoard(oversized)).toMatchObject({
        version: 2,
        subBoards: [],
      });
      async function rawRow() {
        if (fixture.store === local) {
          const connection = new DatabaseSync(localPath);
          try {
            return connection
              .prepare(
                "SELECT payload, revision FROM boards WHERE account_id = ?",
              )
              .get(fixture.owner);
          } finally {
            connection.close();
          }
        }
        return (
          await postgres.query(
            "SELECT payload, revision FROM sayboard.boards WHERE account_id = $1",
            [fixture.owner],
          )
        ).rows[0];
      }
      const before = await rawRow();
      await expect(
        Reflect.apply(fixture.store.saveBoard, fixture.store, [
          fixture.owner,
          oversized,
          previous.revision,
        ]),
      ).rejects.toThrow("too large");
      expect(await rawRow()).toEqual(before);
      expect(await fixture.store.board(fixture.owner)).toEqual(previous);
    });
  });
}
it("server parser accepts every bundled icon and emoji ID without browser globals", () => {
  expect(typeof document).toBe("undefined");
  expect(
    catalogue.filter((entry) => entry.kind === "icon").length,
  ).toBeGreaterThan(1800);
  expect(
    catalogue.filter((entry) => entry.kind === "emoji").length,
  ).toBeGreaterThan(1800);
  const valid = board("large");
  for (const symbol of catalogue) {
    const input = {
      ...valid,
      tiles: [{ ...valid.tiles[0]!, icon: symbol.id }],
    };
    expect(parseBoard(input)).toEqual(input);
  }
});
