import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { parseBoard, serializeBoard, type Board } from "../src/board.js";
import {
  parseProfileSummary,
  type ProfileDetail,
} from "../src/classroom-contract.js";
import type { ClassroomStore } from "./classroom-contract.js";
import { HttpError } from "./api-http.js";

export const PAIRING_MS = 10 * 60_000;
export const DEVICE_MS = 30 * 24 * 60 * 60_000;
type Row = ReturnType<ReturnType<DatabaseSync["prepare"]>["get"]>;
function required(row: Row): NonNullable<Row> {
  if (!row) throw new HttpError(404, "not_found");
  return row;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid classroom storage");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error("Invalid classroom storage");
  return value;
}
function summary(row: NonNullable<Row>) {
  return parseProfileSummary({
    id: row.id,
    label: row.label,
    revision: row.revision,
    publishedVersion: row.published_version,
  });
}

/** One SQLite connection and synchronous transactions own each classroom change. */
export class SqliteClassrooms implements ClassroomStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS classrooms (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS classroom_owners ON classrooms(owner_id);
      CREATE TABLE IF NOT EXISTS classroom_profiles (
        id TEXT PRIMARY KEY, classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        label TEXT NOT NULL, payload TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision > 0), published_version INTEGER NOT NULL DEFAULT 0 CHECK(published_version >= 0)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS profiles_classroom ON classroom_profiles(classroom_id);
      CREATE TABLE IF NOT EXISTS classroom_versions (
        profile_id TEXT NOT NULL REFERENCES classroom_profiles(id) ON DELETE CASCADE,
        number INTEGER NOT NULL CHECK(number > 0), payload TEXT NOT NULL,
        author_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, number)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS classroom_pairings (
        code_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES classroom_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS classroom_devices (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES classroom_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS devices_profile ON classroom_devices(profile_id);
    `);
    // Additive migration keeps existing paired devices valid across upgrades.
    const deviceColumns = new Set(
      db
        .prepare("PRAGMA table_info(classroom_devices)")
        .all()
        .map((row) => string(row.name)),
    );
    for (const column of ["applied_version", "applied_at", "last_seen_at"]) {
      if (!deviceColumns.has(column))
        db.exec(`ALTER TABLE classroom_devices ADD COLUMN ${column} INTEGER`);
    }
  }
  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private owned(owner: string, profileId: string) {
    return required(
      this.db
        .prepare(
          `SELECT p.* FROM classroom_profiles p
      JOIN classrooms c ON c.id = p.classroom_id WHERE p.id = ? AND c.owner_id = ?`,
        )
        .get(profileId, owner),
    );
  }
  private room(owner: string, classroomId: string) {
    return required(
      this.db
        .prepare("SELECT * FROM classrooms WHERE id = ? AND owner_id = ?")
        .get(classroomId, owner),
    );
  }
  private quota(owner: string, extra: number) {
    const row = required(
      this.db
        .prepare(
          `SELECT
      COALESCE((SELECT SUM(length(CAST(p.payload AS BLOB))) FROM classroom_profiles p JOIN classrooms c ON c.id=p.classroom_id WHERE c.owner_id=?), 0) +
      COALESCE((SELECT SUM(length(CAST(v.payload AS BLOB))) FROM classroom_versions v JOIN classroom_profiles p ON p.id=v.profile_id JOIN classrooms c ON c.id=p.classroom_id WHERE c.owner_id=?), 0) AS bytes`,
        )
        .get(owner, owner),
    );
    if (number(row.bytes) + extra > 64 * 1024 * 1024)
      throw new HttpError(409, "classroom_storage_limit");
  }
  list(owner: string) {
    return this.db
      .prepare(
        "SELECT id, name FROM classrooms WHERE owner_id = ? ORDER BY rowid",
      )
      .all(owner)
      .map((row) => ({ id: string(row.id), name: string(row.name) }));
  }
  create(owner: string, name: string) {
    return this.transaction(() => {
      if (this.list(owner).length >= 10)
        throw new HttpError(409, "classroom_limit");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO classrooms VALUES (?, ?, ?)")
        .run(id, owner, name);
      return { id, name };
    });
  }
  detail(owner: string, classroomId: string) {
    const room = this.room(owner, classroomId);
    return {
      id: string(room.id),
      name: string(room.name),
      profiles: this.db
        .prepare(
          "SELECT * FROM classroom_profiles WHERE classroom_id = ? ORDER BY rowid",
        )
        .all(classroomId)
        .map(summary),
    };
  }
  addProfile(owner: string, classroomId: string, label: string, board: Board) {
    return this.transaction(() => {
      if (this.detail(owner, classroomId).profiles.length >= 30)
        throw new HttpError(409, "profile_limit");
      const payload = serializeBoard(board);
      this.quota(owner, Buffer.byteLength(payload));
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO classroom_profiles VALUES (?, ?, ?, ?, 1, 0)")
        .run(id, classroomId, label, payload);
      return this.profile(owner, id);
    });
  }
  profile(owner: string, profileId: string): ProfileDetail {
    const row = this.owned(owner, profileId);
    return {
      ...summary(row),
      board: parseBoard(JSON.parse(string(row.payload))),
      versions: this.db
        .prepare(
          "SELECT number, created_at FROM classroom_versions WHERE profile_id=? ORDER BY number DESC",
        )
        .all(profileId)
        .map((v) => ({
          number: number(v.number),
          createdAt: number(v.created_at),
        })),
      devices: this.db
        .prepare(
          "SELECT id, name, expires_at, applied_version, applied_at, last_seen_at FROM classroom_devices WHERE profile_id=? AND revoked_at IS NULL AND expires_at > ? ORDER BY rowid",
        )
        .all(profileId, Date.now())
        .map((d) => ({
          id: string(d.id),
          name: string(d.name),
          expiresAt: number(d.expires_at),
          appliedVersion:
            d.applied_version === null ? null : number(d.applied_version),
          appliedAt: d.applied_at === null ? null : number(d.applied_at),
          lastSeenAt: d.last_seen_at === null ? null : number(d.last_seen_at),
        })),
    };
  }
  private writeDraft(
    owner: string,
    profileId: string,
    revision: number,
    board: Board,
  ) {
    const row = this.owned(owner, profileId);
    if (row.revision !== revision)
      throw new HttpError(409, "revision_conflict");
    const payload = serializeBoard(board);
    this.quota(
      owner,
      Math.max(
        0,
        Buffer.byteLength(payload) - Buffer.byteLength(string(row.payload)),
      ),
    );
    this.db
      .prepare(
        "UPDATE classroom_profiles SET payload=?, revision=revision+1 WHERE id=? AND revision=?",
      )
      .run(payload, profileId, revision);
  }
  save(owner: string, profileId: string, revision: number, board: Board) {
    return this.transaction(() => {
      this.writeDraft(owner, profileId, revision, board);
      return this.profile(owner, profileId);
    });
  }
  publish(owner: string, profileId: string, revision: number, now: number) {
    return this.transaction(() => {
      const row = this.owned(owner, profileId);
      if (row.revision !== revision)
        throw new HttpError(409, "revision_conflict");
      const current = this.db
        .prepare(
          "SELECT payload FROM classroom_versions WHERE profile_id=? AND number=?",
        )
        .get(profileId, number(row.published_version));
      // Retrying an unchanged publication returns the existing immutable version.
      if (current?.payload === row.payload)
        return this.profile(owner, profileId);
      const version = number(row.published_version) + 1;
      if (version > 200) throw new HttpError(409, "version_limit");
      this.quota(owner, Buffer.byteLength(string(row.payload)));
      this.db
        .prepare("INSERT INTO classroom_versions VALUES (?, ?, ?, ?, ?)")
        .run(profileId, version, string(row.payload), owner, now);
      this.db
        .prepare("UPDATE classroom_profiles SET published_version=? WHERE id=?")
        .run(version, profileId);
      return this.profile(owner, profileId);
    });
  }
  restore(owner: string, profileId: string, revision: number, version: number) {
    return this.transaction(() => {
      this.owned(owner, profileId);
      const old = required(
        this.db
          .prepare(
            "SELECT payload FROM classroom_versions WHERE profile_id=? AND number=?",
          )
          .get(profileId, version),
      );
      this.writeDraft(
        owner,
        profileId,
        revision,
        parseBoard(JSON.parse(string(old.payload))),
      );
      return this.profile(owner, profileId);
    });
  }
  removeProfile(owner: string, profileId: string) {
    this.transaction(() => {
      this.owned(owner, profileId);
      this.db
        .prepare("DELETE FROM classroom_profiles WHERE id=?")
        .run(profileId);
    });
  }
  removeClassroom(owner: string, classroomId: string) {
    this.transaction(() => {
      this.room(owner, classroomId);
      this.db.prepare("DELETE FROM classrooms WHERE id=?").run(classroomId);
    });
  }
  pairCode(
    owner: string,
    profileId: string,
    name: string,
    hash: string,
    now: number,
  ) {
    this.transaction(() => {
      this.owned(owner, profileId);
      this.db
        .prepare(
          "DELETE FROM classroom_pairings WHERE expires_at <= ? OR profile_id=?",
        )
        .run(now, profileId);
      const count = required(
        this.db
          .prepare(
            "SELECT count(*) AS count FROM classroom_devices WHERE profile_id=? AND expires_at>? AND revoked_at IS NULL",
          )
          .get(profileId, now),
      );
      if (number(count.count) >= 20) throw new HttpError(409, "device_limit");
      this.db
        .prepare("INSERT INTO classroom_pairings VALUES (?, ?, ?, ?)")
        .run(hash, profileId, name, now + PAIRING_MS);
    });
  }
  pair(codeHash: string, deviceHash: string, now: number) {
    return this.transaction(() => {
      this.db
        .prepare("DELETE FROM classroom_pairings WHERE expires_at<=?")
        .run(now);
      const pairing = this.db
        .prepare(
          "DELETE FROM classroom_pairings WHERE code_hash=? AND expires_at>? RETURNING *",
        )
        .get(codeHash, now);
      if (!pairing) return false;
      this.db
        .prepare(
          "INSERT INTO classroom_devices (id, profile_id, name, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          string(pairing.profile_id),
          string(pairing.name),
          deviceHash,
          now + DEVICE_MS,
        );
      return true;
    });
  }
  device(hash: string, now: number) {
    const row = this.db
      .prepare(
        `SELECT p.id, p.label, p.published_version, v.payload, d.last_seen_at
      FROM classroom_devices d JOIN classroom_profiles p ON p.id=d.profile_id
      LEFT JOIN classroom_versions v ON v.profile_id=p.id AND v.number=p.published_version
      WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.expires_at>?`,
      )
      .get(hash, now);
    if (!row) return null;
    this.seen(hash, now, row.last_seen_at);
    return {
      profileId: string(row.id),
      label: string(row.label),
      version: number(row.published_version),
      board:
        row.payload === null
          ? null
          : parseBoard(JSON.parse(string(row.payload))),
    };
  }
  private seen(hash: string, now: number, previous: unknown) {
    // Polling stays read-only between heartbeats, keeping WAL writes bounded on small VPSs.
    if (previous === null || number(previous) <= now - 10_000)
      this.db
        .prepare(
          "UPDATE classroom_devices SET last_seen_at=? WHERE token_hash=?",
        )
        .run(now, hash);
  }
  deviceSync(hash: string, now: number) {
    const row = this.db
      .prepare(
        `SELECT p.id, p.label, p.published_version, d.last_seen_at
      FROM classroom_devices d JOIN classroom_profiles p ON p.id=d.profile_id
      WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.expires_at>?`,
      )
      .get(hash, now);
    if (!row) return null;
    this.seen(hash, now, row.last_seen_at);
    return {
      profileId: string(row.id),
      label: string(row.label),
      version: number(row.published_version),
    };
  }
  applied(hash: string, version: number, now: number) {
    this.transaction(() => {
      const device = this.deviceSync(hash, now);
      if (!device) throw new HttpError(401, "device_unlinked");
      if (
        version < 1 ||
        version > device.version ||
        !this.db
          .prepare(
            "SELECT 1 FROM classroom_versions WHERE profile_id=? AND number=?",
          )
          .get(device.profileId, version)
      )
        throw new HttpError(400, "invalid_device_version");
      // Retries and delayed receipts cannot move a device backwards or reset its apply time.
      this.db
        .prepare(
          `UPDATE classroom_devices SET applied_version=?, applied_at=?
        WHERE token_hash=? AND (applied_version IS NULL OR applied_version<?)`,
        )
        .run(version, now, hash, version);
    });
  }
  unlink(hash: string) {
    this.db
      .prepare(
        "UPDATE classroom_devices SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
      )
      .run(Date.now(), hash);
  }
  revoke(owner: string, profileId: string, deviceId: string) {
    this.transaction(() => {
      this.owned(owner, profileId);
      const device = required(
        this.db
          .prepare(
            "SELECT token_hash FROM classroom_devices WHERE id=? AND profile_id=?",
          )
          .get(deviceId, profileId),
      );
      this.unlink(string(device.token_hash));
    });
  }
}
