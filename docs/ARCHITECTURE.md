# Sayboard architecture

The same open-source code serves independent installations and the optional official service. There are no hosting-platform SDKs, managed-authentication clients or analytics in the application.

## Communication and storage

The browser owns its working board. `src/board.ts` validates the complete board, including categories and stable empty slots. `src/board-storage.ts` persists it locally. Account requests are relative same-origin URLs in `src/account.ts`; session cookies are HttpOnly, and CSRF state stays in memory.

The server stores a separate account copy. Sign-in never uploads vocabulary. Loading creates a caregiver draft, and local Save applies it. Revision checks prevent silent overwrites between devices. Cloud failure does not interrupt the local communication path.

## VPS process

Caddy terminates HTTPS and overwrites forwarded headers. The Node server binds only to loopback, serves built static assets and routes `/api/` to the account API. Account mutations require the exact configured Origin and a session-bound CSRF token. Login budgets use a hash of a proxy-validated client IP. Raw IPs, passwords, session tokens and vocabulary are not logged.

SQLite is the default on one VPS. Passwords use salted scrypt; sessions store token hashes. WAL mode and atomic revision comparisons handle concurrent operations. Account provisioning, password resets and consistent backup snapshots run through an operator CLI. Production never creates a default account. The separate development API retains explicit loopback-only demonstration mode.

PostgreSQL implements the same storage contract for operators who need a separate database. It uses ordinary PostgreSQL and verified TLS, with no hosting-vendor lifecycle hook. Shared login budgets are stored in the database.

## Source archives

Production builds create hash-pinned preferred-source archives for the browser and its speech dependencies. A new independent build needs no connection to the official service. At standalone-server startup, `backend/source-retention.ts` merges current archives into persistent instance storage. It preserves old immutable files and rejects changed bytes at an existing URL. The server serves `/source/` from that retained tree.

## Classroom boundary

The current account API stores one copy per adult account. Organisations, memberships, student profiles, published versions, device pairing and billing are future modules. Keep subscriptions separate from data ownership and local communication. See [PROJECT.md](PROJECT.md).
