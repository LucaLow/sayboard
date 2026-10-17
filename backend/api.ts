import { parseBoard } from "../src/board.js";
import type { ApiConfig } from "./config.js";
import type { Store } from "./store-contract.js";
import {
  csrfToken,
  hashPassword,
  matchesToken,
  newToken,
  tokenHash,
  verifyPassword,
} from "./password.js";

export const SESSION_SECONDS = 8 * 60 * 60;
export const MAX_BODY_BYTES = 100_000;
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const json = (status: number, data: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
function sessionToken(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

// Run this before connecting to storage as well as within the authenticated API.
export function requestRejection(
  request: Request,
  peer: string,
  config: ApiConfig,
): Response | null {
  const url = new URL(request.url);
  if (config.kind === "local") {
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) ||
      ![config.origin, config.apiOrigin].includes(url.origin) ||
      [...request.headers.keys()].some(
        (key) => key === "forwarded" || key.startsWith("x-forwarded-"),
      )
    )
      return json(403, { error: "local_only" });
  } else {
    const expectedHost = new URL(config.origin).host;
    if (
      url.origin !== config.origin ||
      (request.headers.has("host") &&
        request.headers.get("host") !== expectedHost) ||
      (request.headers.has("x-forwarded-host") &&
        request.headers.get("x-forwarded-host") !== expectedHost) ||
      (request.headers.has("x-forwarded-proto") &&
        request.headers.get("x-forwarded-proto") !== "https")
    )
      return json(403, { error: "origin_rejected" });
  }
  const origin = request.headers.get("origin");
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (
    (origin !== null && origin !== config.origin) ||
    (mutating && origin !== config.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return json(403, { error: "origin_rejected" });
  return null;
}
async function body(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new HttpError(415, "json_required");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new HttpError(413, "body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid_json");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "body_too_large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json");
  } finally {
    reader.releaseLock();
  }
}
function credentials(value: unknown): { username: string; password: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("username" in value) ||
    !("password" in value) ||
    typeof value.username !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(value.username) ||
    typeof value.password !== "string" ||
    value.password.length < 1 ||
    value.password.length > 256
  )
    throw new HttpError(400, "invalid_credentials");
  return { username: value.username, password: value.password };
}
function boardWrite(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("board" in value) ||
    !("revision" in value) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new HttpError(400, "invalid_board");
  try {
    return { board: parseBoard(value.board), revision: value.revision };
  } catch {
    throw new HttpError(400, "invalid_board");
  }
}

export async function createApi(
  store: Store,
  config: ApiConfig,
  now = Date.now,
) {
  const cookieName =
    config.kind === "hosted" ? "__Host-sayboard_session" : "sayboard_session";
  const cookie = (token: string, seconds: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.kind === "hosted" ? "; Secure" : ""}`;
  const allowedAccount = (account: { username: string; localOnly: boolean }) =>
    config.kind === "local"
      ? account.localOnly
      : !account.localOnly && account.username.toLowerCase() !== "admin";
  // Equal-cost verification for unknown usernames. Generated once at startup.
  const dummyHash = await hashPassword(newToken());
  let passwordChecks = 0;
  return async (request: Request, peer: string): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const rejection = requestRejection(request, peer, config);
      if (rejection) return rejection;
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (url.search) throw new HttpError(400, "query_not_supported");
      const known = [
        "/api/auth/capabilities",
        "/api/auth/login",
        "/api/auth/session",
        "/api/auth/logout",
        "/api/board",
      ];
      if (!known.includes(url.pathname)) throw new HttpError(404, "not_found");
      const allowed =
        url.pathname === "/api/board"
          ? ["GET", "PUT"]
          : ["/api/auth/session", "/api/auth/capabilities"].includes(
                url.pathname,
              )
            ? ["GET"]
            : ["POST"];
      if (!allowed.includes(request.method))
        return json(
          405,
          { error: "method_not_allowed" },
          { Allow: allowed.join(", ") },
        );
      if (url.pathname === "/api/auth/capabilities")
        return json(200, { state: "enabled" });
      if (url.pathname === "/api/auth/login") {
        const input = credentials(await body(request));
        if (!(await store.allowLogin(peer, now())) || passwordChecks >= 2)
          return json(
            429,
            { error: "too_many_attempts" },
            { "Retry-After": "300" },
          );
        // Reserve synchronously before account lookup so concurrent requests cannot
        // pass the cap together while a future database adapter is awaiting I/O.
        passwordChecks++;
        let account;
        let valid: boolean;
        try {
          account = await store.account(input.username);
          valid = await verifyPassword(
            input.password,
            account?.passwordHash ?? dummyHash,
          );
        } finally {
          passwordChecks--;
        }
        if (
          !valid ||
          !account ||
          !allowedAccount(account) ||
          (config.kind === "hosted" && input.password.length < 16)
        )
          throw new HttpError(401, "login_failed");
        // Rotate the browser's previous session at every successful login.
        const previous = sessionToken(request, cookieName);
        if (previous) await store.deleteSession(tokenHash(previous));
        const token = newToken();
        const expiresAt = now() + SESSION_SECONDS * 1000;
        await store.createSession(tokenHash(token), account.id, expiresAt);
        return json(
          200,
          {
            account: { username: account.username },
            csrfToken: csrfToken(token),
            expiresAt,
          },
          { "Set-Cookie": cookie(token, SESSION_SECONDS) },
        );
      }
      const token = sessionToken(request, cookieName);
      const session = token
        ? await store.session(tokenHash(token), now())
        : null;
      if (!token || !session || !allowedAccount(session.account))
        return json(
          401,
          { error: "unauthenticated" },
          { "Set-Cookie": cookie("", 0) },
        );
      if (
        mutating &&
        !matchesToken(request.headers.get("x-csrf-token"), csrfToken(token))
      )
        throw new HttpError(403, "csrf_rejected");
      if (url.pathname === "/api/auth/session")
        return json(200, {
          account: { username: session.account.username },
          csrfToken: csrfToken(token),
          expiresAt: session.expiresAt,
        });
      if (url.pathname === "/api/auth/logout") {
        await store.deleteSession(tokenHash(token));
        return json(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
      }
      // Owner comes exclusively from the server-side session, never client input.
      if (request.method === "GET")
        return json(
          200,
          (await store.board(session.account.id)) ?? {
            board: null,
            revision: 0,
          },
        );
      const input = boardWrite(await body(request));
      const saved = await store.saveBoard(
        session.account.id,
        input.board,
        input.revision,
      );
      if (!saved) throw new HttpError(409, "revision_conflict");
      return json(200, saved);
    } catch (error) {
      if (error instanceof HttpError)
        return json(error.status, { error: error.code });
      // Do not leak SQL, filesystem paths, submitted boards, passwords or tokens.
      return json(503, { error: "storage_unavailable" });
    }
  };
}
