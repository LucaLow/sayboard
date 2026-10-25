import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT, type JWTPayload } from "jose";
import { SqliteStore } from "../store.ts";
import {
  createGoogleHandler,
  GoogleProvider,
  googleConfig,
} from "../google.ts";
import { createApi } from "../api.ts";
import { newToken, tokenHash } from "../password.ts";

const origin = "https://classroom.example.test";
const config = {
  clientId: "synthetic.apps.googleusercontent.com",
  clientSecret: "synthetic-secret",
  allowSignup: true,
};
const hosted = { kind: "hosted", origin } as const;
const codes = new Map<string, { nonce: string; challenge: string }>();
let claims: JWTPayload = {};
let mode = "valid";
let tokenCalls = 0;
let mockOrigin: string;
let privateKey: CryptoKey;
let wrongKey: CryptoKey;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
let store: SqliteStore;
let google: ReturnType<typeof createGoogleHandler>;
let api: Awaited<ReturnType<typeof createApi>>;
let now = Date.now();
const mock = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/keys") {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        keys: [{ ...jwk, kid: "synthetic", alg: "RS256", use: "sig" }],
      }),
    );
    return;
  }
  if (url.pathname === "/authorize") {
    const code = newToken();
    codes.set(code, {
      nonce: url.searchParams.get("nonce") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
    });
    const callback = new URL(url.searchParams.get("redirect_uri") ?? origin);
    callback.search = new URLSearchParams({
      state: url.searchParams.get("state") ?? "",
      code,
    }).toString();
    response.writeHead(302, { Location: callback.href });
    response.end();
    return;
  }
  if (url.pathname === "/token") {
    tokenCalls++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = new URLSearchParams(Buffer.concat(chunks).toString());
    const attempt = codes.get(input.get("code") ?? "");
    codes.delete(input.get("code") ?? "");
    if (
      !attempt ||
      input.get("client_secret") !== config.clientSecret ||
      input.get("client_id") !== config.clientId ||
      input.get("redirect_uri") !== origin + "/api/auth/google/callback" ||
      createHash("sha256")
        .update(input.get("code_verifier") ?? "")
        .digest("base64url") !== attempt.challenge ||
      mode === "unavailable"
    ) {
      response.writeHead(503);
      response.end("provider-private-diagnostic");
      return;
    }
    if (mode === "oversized") {
      response.end("x".repeat(65_000));
      return;
    }
    if (mode === "invalid-json") {
      response.end("not json");
      return;
    }
    const seconds = Math.floor(now / 1000);
    const token = await new SignJWT({
      email_verified: true,
      nonce: attempt.nonce,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
      .setSubject(
        typeof claims.sub === "string" ? claims.sub : "google-subject-a",
      )
      .setIssuer(
        typeof claims.iss === "string"
          ? claims.iss
          : "https://accounts.google.com",
      )
      .setAudience(claims.aud ?? config.clientId)
      .setIssuedAt(typeof claims.iat === "number" ? claims.iat : seconds)
      .setExpirationTime(
        typeof claims.exp === "number" ? claims.exp : seconds + 300,
      )
      .sign(mode === "forged" ? wrongKey : privateKey);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id_token: token }));
    return;
  }
  response.writeHead(404);
  response.end();
});
beforeAll(async () => {
  const key = await generateKeyPair("RS256");
  privateKey = key.privateKey;
  jwk = await exportJWK(key.publicKey);
  wrongKey = (await generateKeyPair("RS256")).privateKey;
  await new Promise<void>((resolve, reject) => {
    mock.once("error", reject);
    mock.listen(0, "127.0.0.1", resolve);
  });
  const address = mock.address();
  if (!address || typeof address === "string")
    throw new Error("Missing mock port");
  mockOrigin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  mock.closeAllConnections();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});
beforeEach(async () => {
  now = Date.now();
  claims = {};
  mode = "valid";
  tokenCalls = 0;
  codes.clear();
  store = new SqliteStore(":memory:");
  google = createGoogleHandler(
    store,
    hosted,
    config,
    () => now,
    new GoogleProvider(config, {
      authorization: mockOrigin + "/authorize",
      token: mockOrigin + "/token",
      jwks: mockOrigin + "/keys",
    }),
  );
  api = await createApi(store, hosted, () => now);
});
afterEach(() => store.close());
function request(path: string, init: RequestInit = {}) {
  return google(new Request(origin + path, init), "synthetic-peer");
}
async function begin() {
  const response = await request("/api/auth/google/start", {
    method: "POST",
    headers: { Origin: origin },
  });
  expect(response.status).toBe(200);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("url" in data) ||
    typeof data.url !== "string"
  )
    throw new Error("Missing authorization URL");
  const url = data.url;
  const browserCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const consent = await fetch(url, { redirect: "manual" });
  return {
    start: response,
    callback: new URL(consent.headers.get("location") ?? origin),
    browserCookie,
  };
}
async function finish(
  attempt: Awaited<ReturnType<typeof begin>>,
  cookie = attempt.browserCookie,
) {
  return request(attempt.callback.pathname + attempt.callback.search, {
    headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
  });
}
async function authenticated() {
  const attempt = await begin();
  const response = await finish(attempt);
  expect(response.headers.get("location")).toBe("/teacher");
  const sessionCookie =
    response.headers
      .getSetCookie()
      .find((s) => s.startsWith("__Host-sayboard_session="))
      ?.split(";")[0] ?? "";
  const session = await api(
    new Request(origin + "/api/auth/session", {
      headers: { Cookie: sessionCookie },
    }),
    "synthetic-peer",
  );
  expect(session.status).toBe(200);
  return { attempt, response, sessionCookie, value: await session.json() };
}
it("is optional, rejects incomplete config and never enables signup implicitly", () => {
  expect(googleConfig({})).toBeNull();
  const env = {
    SAYBOARD_AUTH_ENABLED: "1",
    SAYBOARD_STORAGE: "sqlite",
    SAYBOARD_GOOGLE_CLIENT_ID: config.clientId,
    SAYBOARD_GOOGLE_CLIENT_SECRET: config.clientSecret,
  };
  expect(googleConfig(env)).toEqual({ ...config, allowSignup: false });
  expect(() =>
    googleConfig({ ...env, SAYBOARD_GOOGLE_CLIENT_SECRET: "" }),
  ).toThrow();
  expect(() =>
    googleConfig({ ...env, SAYBOARD_STORAGE: "postgres" }),
  ).toThrow();
  expect(() => googleConfig({ ...env, SAYBOARD_AUTH_ENABLED: "0" })).toThrow();
  expect(() => googleConfig({ SAYBOARD_GOOGLE_SIGNUP_ENABLED: "1" })).toThrow();
  expect(() =>
    googleConfig({ SAYBOARD_GOOGLE_SIGNUP_ENABLED: "yes" }),
  ).toThrow();
});
it("creates one ordinary teacher account through real token/JWK HTTP exchange and keeps password login disabled", async () => {
  const { response, sessionCookie, value } = await authenticated();
  expect(response.headers.getSetCookie()).toHaveLength(2);
  expect(response.headers.getSetCookie()[0]).toContain(
    "SameSite=Lax; Max-Age=0",
  );
  expect(response.headers.getSetCookie()[1]).toContain(
    "HttpOnly; SameSite=Strict",
  );
  expect(value.account.username).toMatch(/^teacher_[a-f0-9]{16}$/);
  expect(
    store.onboarding.isOperator(
      (await store.account(value.account.username))?.id ?? "",
    ),
  ).toBe(false);
  const login = await api(
    new Request(origin + "/api/auth/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: value.account.username,
        password: "external:google",
      }),
    }),
    "synthetic-peer",
  );
  expect(login.status).toBe(401);
  const invites = await api(
    new Request(origin + "/api/invitations", {
      headers: { Cookie: sessionCookie },
    }),
    "synthetic-peer",
  );
  expect(await invites.json()).toMatchObject({ operator: false });
  const returning = await authenticated();
  expect(returning.value.account).toEqual(value.account);
});
it("uses only immutable Google subjects, never an email match or a browser-supplied privilege", async () => {
  await store.addAccount(
    "existing_teacher",
    "Synthetic existing password",
    false,
  );
  store.onboarding.enableOperator("existing_teacher");
  claims = { email: "same@example.test", operator: true };
  const first = await authenticated();
  claims = {
    sub: "google-subject-b",
    email: "same@example.test",
    operator: true,
  };
  const second = await authenticated();
  expect(second.value.account.username).not.toBe(first.value.account.username);
  expect(first.value.account.username).not.toBe("existing_teacher");
  expect(
    store.onboarding.isOperator(
      (await store.account(first.value.account.username))?.id ?? "",
    ),
  ).toBe(false);
  claims = { email: "changed@example.test" };
  expect((await authenticated()).value.account).toEqual(first.value.account);
});
it("requires explicit signup permission but permits existing Google teachers after signup closes", async () => {
  const known = await authenticated();
  google = createGoogleHandler(
    store,
    hosted,
    { ...config, allowSignup: false },
    () => now,
    new GoogleProvider(config, {
      authorization: mockOrigin + "/authorize",
      token: mockOrigin + "/token",
      jwks: mockOrigin + "/keys",
    }),
  );
  expect((await authenticated()).value.account).toEqual(known.value.account);
  claims = { sub: "new-subject" };
  const rejected = await finish(await begin());
  expect(rejected.headers.get("location")).toBe(
    "/teacher#google=signup-disabled",
  );
  expect(rejected.headers.getSetCookie()).toHaveLength(1);
});
it.each([
  ["wrong issuer", { iss: "https://forged.example" }],
  ["wrong audience", { aud: "other.apps.googleusercontent.com" }],
  ["expired", { exp: 1 }],
  ["unverified email", { email_verified: false }],
  ["wrong nonce", { nonce: "forged" }],
  ["multiple audiences without presenter", { aud: [config.clientId, "other"] }],
  ["wrong presenter", { azp: "other" }],
])(
  "rejects %s without a session or provider details",
  async (_label, invalidClaims) => {
    claims = invalidClaims;
    const response = await finish(await begin());
    expect(response.headers.get("location")).toBe("/teacher#google=failed");
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(await response.text()).toBe("");
  },
);
it.each(["forged", "unavailable", "oversized", "invalid-json"])(
  "rejects provider %s safely",
  async (failure) => {
    mode = failure;
    const response = await finish(await begin());
    expect(response.headers.get("location")).toBe("/teacher#google=failed");
    expect(response.headers.getSetCookie()).toHaveLength(1);
  },
);
it("rejects login CSRF, state/browser mismatch, duplicate state and callback replay before network work", async () => {
  const attempt = await begin();
  expect((await finish(attempt, "")).headers.get("location")).toBe(
    "/teacher#google=failed",
  );
  expect(tokenCalls).toBe(0);
  expect(
    (await finish(attempt, "__Host-sayboard_google=" + newToken())).headers.get(
      "location",
    ),
  ).toBe("/teacher#google=failed");
  expect(tokenCalls).toBe(0);
  const duplicates = new URL(attempt.callback);
  duplicates.searchParams.append("state", newToken());
  expect(
    (await finish({ ...attempt, callback: duplicates })).headers.get(
      "location",
    ),
  ).toBe("/teacher#google=failed");
  expect(tokenCalls).toBe(0);
  expect((await finish(attempt)).headers.get("location")).toBe("/teacher");
  expect(tokenCalls).toBe(1);
  expect((await finish(attempt)).headers.get("location")).toBe(
    "/teacher#google=failed",
  );
  expect(tokenCalls).toBe(1);
});
it("expires, consumes cancellation and supersedes earlier starts in the same browser", async () => {
  const old = await begin();
  const next = await request("/api/auth/google/start", {
    method: "POST",
    headers: { Origin: origin, Cookie: old.browserCookie },
  });
  expect(next.status).toBe(200);
  expect((await finish(old)).headers.get("location")).toBe(
    "/teacher#google=failed",
  );
  const cancelled = await begin();
  cancelled.callback.searchParams.set("error", "access_denied");
  expect((await finish(cancelled)).headers.get("location")).toBe(
    "/teacher#google=cancelled",
  );
  expect((await finish(cancelled)).headers.get("location")).toBe(
    "/teacher#google=failed",
  );
  const expired = await begin();
  now += 600_001;
  expect((await finish(expired)).headers.get("location")).toBe(
    "/teacher#google=failed",
  );
  expect(tokenCalls).toBe(0);
});
it("allows cross-site navigation only on the callback, and rejects foreign Host/Origin or arbitrary return URLs", async () => {
  expect(
    (
      await request("/api/auth/google/start", {
        method: "POST",
        headers: { Origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await request("/api/auth/google/start", { method: "POST" })).status,
  ).toBe(403);
  expect(
    (
      await request("/api/auth/google/start", {
        method: "POST",
        headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/api/auth/google/start?return=https://evil.test", {
        method: "POST",
        headers: { Origin: origin },
      })
    ).status,
  ).toBe(400);
  const attempt = await begin();
  expect(
    (
      await request(attempt.callback.pathname + attempt.callback.search, {
        headers: { Host: "evil.test", Cookie: attempt.browserCookie },
      })
    ).status,
  ).toBe(403);
  expect(tokenCalls).toBe(0);
  const result = await finish(attempt);
  expect(result.headers.get("location")).toBe("/teacher");
});
it("bounds start attempts and advertises only non-secret availability", async () => {
  expect(await (await request("/api/auth/google/config")).json()).toEqual({
    enabled: true,
    signupEnabled: true,
  });
  for (let i = 0; i < 10; i++) expect((await begin()).start.status).toBe(200);
  expect(
    (
      await request("/api/auth/google/start", {
        method: "POST",
        headers: { Origin: origin },
      })
    ).status,
  ).toBe(429);
});
it("identity deletion cascades, and persisted attempts contain hashes rather than raw state/browser values", async () => {
  const { value } = await authenticated();
  store.deleteAccount(value.account.username);
  expect(await store.account(value.account.username)).toBeNull();
  expect((await authenticated()).value.account.username).not.toBe(
    value.account.username,
  );
  const attempt = await begin();
  const state = attempt.callback.searchParams.get("state") ?? "";
  expect(() =>
    store.google.consume(state, attempt.browserCookie.split("=")[1], now),
  ).toThrow();
  expect(
    store.google.consume(
      tokenHash(state),
      tokenHash(attempt.browserCookie.split("=")[1]),
      now,
    ),
  ).toMatchObject({ nonce: expect.any(String), verifier: expect.any(String) });
});
