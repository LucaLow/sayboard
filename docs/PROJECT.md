# Sayboard project and hosting plan

Sayboard is a fully open-source product with optional paid official hosting. There is no private edition of the teacher dashboard or server. A technically capable person or school can run the published software themselves under its licences.

## Free communication app

The free app includes board creation, editing, speech, device saving, import and export. It requires no account. The free app can run on any static HTTPS host.

Keep the local communication path independent of account availability and billing. An expired session, cloud outage or subscription cancellation must never remove the working board from a device or prevent local speech and export. A hosted board must become a validated local copy before replacing a device's current board.

Browser storage is not a permanent backup. Offline startup and speech need device-specific verification before they can be advertised as guaranteed. Open-source distribution also allows someone else to host the app if the official service closes; it does not guarantee perpetual operation of one website.

## Optional official hosting

The proposed paid service handles teacher accounts, classroom permissions, saved boards, device linking, version history, hosting and backups. Student communication remains free. Start with one classroom plan and student access included rather than charging each student.

Personal cloud-backup pricing and classroom prices are undecided. The owner requested that these decisions follow a teacher pilot. Do not add a paywall, promise free unlimited cloud storage or publish a price before that decision.

Public source code does not make customer data public. Production records, credentials, support evidence and database backups remain private. The software licence permits self-hosting and commercial reuse; official-service terms govern the service people buy.

## Current implementation

| Capability | Status |
| --- | --- |
| Local boards, editing, speech, import and export | Implemented; see [device and offline limits](SELF-HOSTING.md#serve-only-the-static-app) |
| Standalone account backup | Implemented with SQLite, operator-created accounts, explicit save/load and revision checks |
| Optional PostgreSQL adapter | Implemented against the same account storage contract |
| Classroom dashboard, organisations and permissions | Planned |
| Device pairing and published board updates | Planned |
| Subscriptions and billing | Planned; prices undecided |

The current account API stores one board copy per adult account. It is not a classroom or multi-board model. Add classroom ownership explicitly rather than granting a teacher access to unrelated personal backups.

## First teacher pilot

Prove this workflow before adding billing:

1. A teacher creates a classroom and a demonstration student profile without requiring a student email address.
2. The teacher creates or imports a board and previews it.
3. A caregiver deliberately links a device to that profile with an expiring, single-use pairing code.
4. The teacher publishes an immutable board version. The linked device receives it at a safe point and keeps its last working local version if a transfer fails.
5. The teacher restores a previous version. Removing device access stops future cloud transfers without deleting its working local board.

Keep drafts separate from published versions. An edit on the teacher dashboard must not rearrange tiles while the person is communicating. Store no history of what the student says. Record publication and permission changes without copying vocabulary into logs.

## Proposed data ownership

This is a design for the next implementation milestone, not an applied database schema.

| Record | Owns |
| --- | --- |
| Organisation | A school or classroom workspace |
| Membership | An adult account's role in one organisation |
| Student profile | A workspace-specific label and board assignment, with no student login required for the pilot |
| Board | A teacher-editable draft and a pointer to its published version |
| Board version | An immutable, validated board snapshot with a revision and author |
| Device link | Scoped read access to one assigned profile, with revocation and expiring pairing credentials |
| Subscription | Official hosted-service entitlement for the organisation, separate from board ownership and membership |

The database or server enforces organisation membership on every read and write. A teacher in one organisation cannot access another organisation's boards. Device credentials only read assigned published versions. They cannot list students, edit boards or manage billing.

Keep subscription checks at hosted-service boundaries. Self-hosted deployments use the same classroom code without an official billing account. The local app does not know whether a classroom subscription is active.

## Delivery order

1. Prepare public licensing, contributor instructions, self-hosting, publication checks and a free-app browser check.
2. Review repository history and GitHub content, enable private vulnerability reporting, and publish the prepared project.
3. Verify operator provisioning, password reset, cross-device backup and restore with synthetic accounts.
4. Implement the classroom model, permissions and a small dashboard in the public repository.
5. Verify device pairing, safe publishing, rollback, cloud outages, account revocation and organisation isolation.
6. Run a teacher pilot. Agree the personal-backup policy and a sustainable classroom price using actual operating and support costs.
7. Add hosted subscriptions, cancellation behaviour, data retention, privacy terms and support arrangements before taking payments.

The first step is repository preparation. It does not make the classroom service production-ready. The next product input is a teacher willing to test with demonstration boards. An official VPS deployment needs a server and a hostname pointing at it. Email is not required for operator-provisioned accounts.
