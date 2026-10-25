import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Account } from "./store-contract.js";
import { HttpError } from "./api-http.js";

export type GoogleAttempt = { nonce: string; verifier: string };
export interface GoogleStore {
  begin(
    stateHash: string,
    browserHash: string,
    attempt: GoogleAttempt,
    now: number,
  ): void;
  consume(stateHash: string, browserHash: string, now: number): GoogleAttempt;
  account(subject: string, allowSignup: boolean): Account;
}

export class SqliteGoogleStore implements GoogleStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS google_identities (
        subject TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS google_login_attempts (
        state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL UNIQUE,
        nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS google_attempt_expiry ON google_login_attempts(expires_at);
    `);
  }
  begin(
    stateHash: string,
    browserHash: string,
    attempt: GoogleAttempt,
    now: number,
  ): void {
    this.db
      .prepare(
        "DELETE FROM google_login_attempts WHERE expires_at<=? OR browser_hash=?",
      )
      .run(now, browserHash);
    const count = this.db
      .prepare("SELECT count(*) AS count FROM google_login_attempts")
      .get();
    if (!count || typeof count.count !== "number" || count.count >= 2000)
      throw new HttpError(429, "too_many_attempts");
    this.db
      .prepare("INSERT INTO google_login_attempts VALUES (?, ?, ?, ?, ?)")
      .run(
        stateHash,
        browserHash,
        attempt.nonce,
        attempt.verifier,
        now + 10 * 60_000,
      );
  }
  consume(stateHash: string, browserHash: string, now: number): GoogleAttempt {
    this.db
      .prepare("DELETE FROM google_login_attempts WHERE expires_at<=?")
      .run(now);
    // Consume before network I/O. Parallel callbacks and replay cannot exchange twice.
    const row = this.db
      .prepare(
        `DELETE FROM google_login_attempts
      WHERE state_hash=? AND browser_hash=? RETURNING nonce,verifier`,
      )
      .get(stateHash, browserHash);
    if (
      !row ||
      typeof row.nonce !== "string" ||
      typeof row.verifier !== "string"
    )
      throw new HttpError(403, "google_login_expired");
    return { nonce: row.nonce, verifier: row.verifier };
  }
  account(subject: string, allowSignup: boolean): Account {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let row = this.db
        .prepare(
          `SELECT accounts.* FROM accounts
        JOIN google_identities ON google_identities.account_id=accounts.id
        WHERE google_identities.subject=?`,
        )
        .get(subject);
      if (!row) {
        if (!allowSignup) throw new HttpError(403, "google_signup_disabled");
        const id = randomUUID();
        const username =
          "teacher_" + randomUUID().replaceAll("-", "").slice(0, 16);
        this.db
          .prepare("INSERT INTO accounts VALUES (?, ?, 'external:google', 0)")
          .run(id, username);
        this.db
          .prepare("INSERT INTO google_identities VALUES (?, ?)")
          .run(subject, id);
        row = this.db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
      }
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.username !== "string" ||
        typeof row.password_hash !== "string" ||
        row.local_only !== 0
      )
        throw new Error("Invalid Google account storage");
      const account = {
        id: row.id,
        username: row.username,
        passwordHash: row.password_hash,
        localOnly: false,
      };
      this.db.exec("COMMIT");
      return account;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
