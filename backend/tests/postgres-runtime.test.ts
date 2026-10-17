import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => {
  const pools: unknown[] = [];
  return {
    pools,
    query:
      vi.fn<
        (
          sql: string,
          params: (string | number)[],
        ) => Promise<{ rows: unknown[] }>
      >(),
    end: vi.fn<() => Promise<void>>(),
    on: vi.fn(),
  };
});
vi.mock("pg", () => ({
  Pool: class {
    query = fake.query;
    end = fake.end;
    on = fake.on;
    constructor(options: unknown) {
      fake.pools.push(options);
    }
  },
}));
import { productionStoreFactory } from "../postgres-runtime.ts";
const env = {
  NODE_ENV: "production",
  SAYBOARD_STORAGE: "postgres",
  DATABASE_URL:
    "postgresql://synthetic:unused@database.example.test/sayboard?sslmode=require",
};
beforeEach(() => {
  fake.pools.length = 0;
  fake.query.mockReset().mockResolvedValue({ rows: [{ version: 2 }] });
  fake.end.mockReset().mockResolvedValue();
  fake.on.mockReset();
});
it("initializes one pool lazily, shares simultaneous requests", async () => {
  const getStore = productionStoreFactory(env);
  expect(fake.pools).toHaveLength(0);
  const first = getStore();
  expect(getStore()).toBe(first);
  const [a, b] = await Promise.all([first, getStore()]);
  expect(a).toBe(b);
  expect(fake.pools).toHaveLength(1);
  expect(fake.on).toHaveBeenCalledWith("error", expect.any(Function));
  expect(fake.query).toHaveBeenCalledExactlyOnceWith(
    "SELECT version FROM sayboard.schema_version WHERE singleton = TRUE",
    [],
  );
  expect(fake.end).not.toHaveBeenCalled();
  fake.query.mockResolvedValueOnce({ rows: [] });
  expect(await a.board("00000000-0000-4000-8000-000000000000")).toBeNull();
  expect(fake.pools).toHaveLength(1);
});
it("closes failed initialization, hides driver details, and allows a later retry", async () => {
  fake.query.mockRejectedValueOnce(
    new Error("synthetic driver connection detail"),
  );
  const getStore = productionStoreFactory(env);
  await expect(getStore()).rejects.toThrow(
    "PostgreSQL storage unavailable or schema not applied",
  );
  expect(fake.end).toHaveBeenCalledOnce();
  await getStore();
  expect(fake.pools).toHaveLength(2);
});
it("fails before constructing a pool when configuration is absent", async () => {
  await expect(productionStoreFactory({})()).rejects.toThrow("not configured");
  expect(fake.pools).toHaveLength(0);
});
it("fails closed and closes the pool for an unmigrated schema", async () => {
  fake.query.mockResolvedValueOnce({ rows: [{ version: 1 }] });
  await expect(productionStoreFactory(env)()).rejects.toThrow(
    "schema not applied",
  );
  expect(fake.end).toHaveBeenCalledOnce();
});
