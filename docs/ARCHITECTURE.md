# Sayboard architecture

The same open-source code serves independent installations and the optional official service. There are no hosting-platform SDKs, managed-authentication clients or analytics in the application.

## Communication and storage

The browser owns its working board. `src/board.ts` validates the complete board, including categories and stable empty slots. `src/board-storage.ts` persists it locally. Account requests are relative same-origin URLs in `src/account.ts`; session cookies are HttpOnly, and CSRF state stays in memory.

The server stores a separate account copy. Sign-in never uploads vocabulary. Loading creates a caregiver draft, and local Save applies it. Revision checks prevent silent overwrites between devices. Cloud failure does not interrupt the local communication path.

## VPS process

Caddy terminates HTTPS and overwrites forwarded headers. The Node server binds only to loopback, serves built static assets and routes `/api/` to the account API. Account mutations require the exact configured Origin and a session-bound CSRF token. Login budgets use a hash of a proxy-validated client IP. Raw IPs, passwords, session tokens and vocabulary are not logged.

SQLite is the default on one VPS. Passwords use salted scrypt; sessions store token hashes. WAL mode and atomic revision comparisons handle concurrent operations. Account provisioning, password resets and consistent backup snapshots run through an operator CLI. Production never creates a default account. The separate development API retains explicit loopback-only demonstration mode.

PostgreSQL implements personal account backups for operators who need a separate database. It uses ordinary PostgreSQL and verified TLS, with no hosting-vendor lifecycle hook. Shared login budgets are stored in the database. Classroom storage currently requires SQLite.

## Source archives

Production builds create hash-pinned preferred-source archives for the browser and its speech dependencies. A new independent build needs no connection to the official service. At standalone-server startup, `backend/source-retention.ts` merges current archives into persistent instance storage. It preserves old immutable files and rejects changed bytes at an existing URL. The server serves `/source/` from that retained tree.

## Classroom boundary

`teacher.html` and `src/teacher.ts` provide the adult workspace. `src/classroom-client.ts` parses every network response against `src/classroom-contract.ts`. Teacher editing reuses the communication app with an explicit profile ID. That editor saves to the server and does not write its board to browser storage. Preview uses the actual communication view.

`backend/classroom-api.ts` receives the authenticated adult ID from the existing account API. `backend/classroom-store.ts` owns SQLite classroom queries and synchronous transactions. Ownership is checked in each read and mutation. The first pilot has one adult owner per classroom. Shared school memberships and roles are future work.

| Record            | Owner and lifecycle                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Classroom         | One authenticated adult account                                                                   |
| Profile           | One classroom, identified by an alias without a student account                                   |
| Draft             | One profile, validated board plus revision for compare-and-swap saves                             |
| Published version | Immutable profile snapshot with publication time and adult author                                 |
| Pairing code      | One profile and device name, hashed, single use, expires after 10 minutes                         |
| Device credential | Hashed random token, reads one profile's current publication, expires after 30 days or revocation |

Publication copies a saved draft into an immutable version. Retrying publication of unchanged content returns the existing version. Restoring a version changes only the draft until the teacher publishes again.

The caregiver explicitly confirms pairing once. The linked device then checks for the latest publication while the app is open. It downloads and validates a complete board, waits for speech, typing and caregiver editing to finish, and saves the board locally before applying it and reporting receipt. Failed downloads or local saves leave the previous working board intact. Reconnecting devices catch up with the latest publication. Revocation blocks future transfers and preserves the device's saved board. Unlinked communication boards make no classroom requests.

Device records hold the last reported applied version, receipt time and last server contact. The teacher dashboard refreshes reports every five seconds while visible. It updates only the device report list, preserving active forms, draft state and pairing codes. A publication is available immediately, but only a device's receipt confirms that the publication was saved there. Last contact cannot distinguish a network outage from a closed or suspended browser.

The device API has separate HttpOnly credentials and CSRF protection. It cannot list classrooms, edit drafts or manage accounts. Classroom deletion cascades through server-side profiles, versions, pairing codes and device credentials. Operator account deletion also removes that adult's personal backup and sessions. Rotating encrypted backups retain older records until expiry.

Storage limits bound a pilot account to 10 classrooms, 30 profiles per classroom and 64 MiB of combined draft and version payloads. A profile can have 200 published versions and 20 active linked devices. Pairing attempts share a persisted 10-attempt, five-minute peer budget. The small-VPS configuration admits one password hash at a time while keeping the scrypt cost unchanged.

Billing does not participate in local communication or data ownership. No subscription code is included in this pilot. See [PROJECT.md](PROJECT.md).

## Teacher invitations

`backend/onboarding.ts` owns organiser permissions and SQLite invitation records. Organiser permission is granted through the maintenance CLI, never inferred from a username or client payload. `POST /api/invitations` requires an authenticated organiser, exact Origin and CSRF token. Unauthenticated activation requires a random 256-bit token whose hash alone is stored. Tokens travel in the invitation URL fragment, are removed from the address bar when opened, and are submitted only in bounded JSON bodies. Activation and login share the password-hashing concurrency cap.

Invitation acceptance is a transaction that consumes the token and creates an ordinary teacher account. Reset acceptance updates the existing password and revokes its sessions. Expiry, reissue and cancellation invalidate unused links. Activation attempts and organiser invitation requests have persisted rate budgets. There is no public signup or self-service recovery endpoint.

`backend/mail.ts` supplies optional SMTP transport with required TLS, certificate validation, disabled protocol logging and no file or URL attachments. It sends only an explicitly requested invitation or reset message. A delivery failure preserves the private link as a fallback and returns no provider error details. SMTP configuration remains server-side. Resend and Postmark can use the same transport; the self-hosted application has no provider SDK dependency.
