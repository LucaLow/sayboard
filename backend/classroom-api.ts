import { randomBytes } from "node:crypto";
import { parseBoard, starterBoard } from "../src/board.js";
import { record, text, integer, id } from "../src/classroom-contract.js";
import type { ClassroomStore } from "./classroom-contract.js";
import type { Store } from "./store-contract.js";
import type { ApiConfig } from "./config.js";
import { body, HttpError, json, sessionToken } from "./api-http.js";
import { csrfToken, matchesToken, newToken, tokenHash } from "./password.js";
import { DEVICE_MS, PAIRING_MS } from "./classroom-store.js";

function validated<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new HttpError(400, "invalid_classroom_input");
  }
}
function method(request: Request, allowed: string[]) {
  if (!allowed.includes(request.method))
    throw new HttpError(405, "method_not_allowed", {
      Allow: allowed.join(", "),
    });
}
function available(store: ClassroomStore | undefined): ClassroomStore {
  if (!store) throw new HttpError(503, "classrooms_require_sqlite");
  return store;
}
export async function teacherApi(
  request: Request,
  store: ClassroomStore | undefined,
  owner: string,
  now: number,
) {
  const classrooms = available(store);
  const path = new URL(request.url).pathname;
  if (path === "/api/classrooms") {
    method(request, ["GET", "POST"]);
    if (request.method === "GET")
      return json(200, { classrooms: classrooms.list(owner) });
    const input = await body(request);
    const name = validated(() => text(record(input).name));
    return json(201, classrooms.create(owner, name));
  }
  const parts = path.split("/").slice(2);
  const target = validated(() => id(parts[1]));
  if (parts[0] === "classrooms") {
    if (parts.length === 2) {
      method(request, ["GET", "DELETE"]);
      if (request.method === "GET")
        return json(200, classrooms.detail(owner, target));
      classrooms.removeClassroom(owner, target);
      return json(200, { ok: true });
    }
    if (parts.length === 3 && parts[2] === "profiles") {
      method(request, ["POST"]);
      const input = await body(request);
      const value = validated(() => {
        const row = record(input);
        return {
          label: text(row.label),
          board:
            row.board === undefined ? starterBoard() : parseBoard(row.board),
        };
      });
      return json(
        201,
        classrooms.addProfile(owner, target, value.label, value.board),
      );
    }
  }
  if (parts[0] === "profiles") {
    if (parts.length === 2) {
      method(request, ["GET", "PUT", "DELETE"]);
      if (request.method === "GET")
        return json(200, classrooms.profile(owner, target));
      if (request.method === "DELETE") {
        classrooms.removeProfile(owner, target);
        return json(200, { ok: true });
      }
      const input = await body(request);
      const value = validated(() => {
        const row = record(input);
        return {
          revision: integer(row.revision),
          board: parseBoard(row.board),
        };
      });
      return json(
        200,
        classrooms.save(owner, target, value.revision, value.board),
      );
    }
    if (
      parts.length === 3 &&
      ["publish", "restore", "pairing"].includes(parts[2])
    ) {
      method(request, ["POST"]);
      const input = await body(request);
      const row = validated(() => record(input));
      if (parts[2] === "publish") {
        const revision = validated(() => integer(row.revision));
        return json(200, classrooms.publish(owner, target, revision, now));
      }
      if (parts[2] === "restore") {
        const value = validated(() => ({
          revision: integer(row.revision),
          version: integer(row.version),
        }));
        return json(
          200,
          classrooms.restore(owner, target, value.revision, value.version),
        );
      }
      const name = validated(() => text(row.name, 60));
      const code = randomBytes(5).toString("hex").toUpperCase();
      classrooms.pairCode(owner, target, name, tokenHash(code), now);
      return json(200, { code, expiresAt: now + PAIRING_MS });
    }
    if (parts.length === 4 && parts[2] === "devices") {
      method(request, ["DELETE"]);
      const deviceId = validated(() => id(parts[3]));
      classrooms.revoke(owner, target, deviceId);
      return json(200, { ok: true });
    }
  }
  throw new HttpError(404, "not_found");
}

/** Device credentials can read exactly one published board; no teacher routes. */
export async function deviceApi(
  request: Request,
  store: Store,
  config: ApiConfig,
  peer: string,
  now: number,
) {
  const classrooms = available(store.classrooms);
  const name =
    config.kind === "hosted" ? "__Host-sayboard_device" : "sayboard_device";
  const cookie = (token: string, seconds: number) =>
    `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.kind === "hosted" ? "; Secure" : ""}`;
  const path = new URL(request.url).pathname;
  if (path === "/api/device/pair") {
    method(request, ["POST"]);
    if (!(await store.allowLogin(`pair:${peer}`, now)))
      return json(
        429,
        { error: "too_many_attempts" },
        { "Retry-After": "300" },
      );
    const input = await body(request);
    const code = validated(() => {
      const code = text(record(input).code, 20)
        .replace(/[\s-]/g, "")
        .toUpperCase();
      if (!/^[A-F0-9]{10}$/.test(code)) throw new Error("Invalid code");
      return code;
    });
    const token = newToken();
    if (!classrooms.pair(tokenHash(code), tokenHash(token), now))
      throw new HttpError(401, "pairing_unavailable");
    const previous = sessionToken(request, name);
    if (previous) classrooms.unlink(tokenHash(previous));
    return json(
      200,
      { ok: true },
      { "Set-Cookie": cookie(token, DEVICE_MS / 1000) },
    );
  }
  if (!["/api/device/board", "/api/device/unlink"].includes(path))
    throw new HttpError(404, "not_found");
  method(request, path.endsWith("board") ? ["GET"] : ["POST"]);
  const token = sessionToken(request, name);
  const current = token ? classrooms.device(tokenHash(token), now) : null;
  if (!token || !current)
    return json(
      401,
      { error: "device_unlinked" },
      { "Set-Cookie": cookie("", 0) },
    );
  if (request.method === "GET")
    return json(200, { ...current, csrfToken: csrfToken(token) });
  if (!matchesToken(request.headers.get("x-csrf-token"), csrfToken(token)))
    throw new HttpError(403, "csrf_rejected");
  classrooms.unlink(tokenHash(token));
  return json(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
}
