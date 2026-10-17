# Category contract

Implemented against the merged account, hosted packaging and communication-layout contracts. The frontend, import/export, account client and backend stores share `src/board.ts`; there is no account schema fork.

## Serialized board

Version 2 keeps the root `tiles`, `size`, `voice` and `rate`. It adds `subBoards`, an array of `{ id, tiles, size }`. Each word has `kind: "word"`. Each category has `kind: "category"` and `subBoardId`, with the existing label, phrase, icon, tone and tile ID retained. A category opens its referenced board instead of speaking. Each sub-board has its own tile-size setting. Voice and rate belong to the complete board.

The first release permits categories at the root and words inside categories. The referenced-board representation permits future hierarchy extension without changing slot serialization. The shared parser validates ownership and reachability before returning a Board. Missing targets, repeated ownership, duplicate IDs, orphan boards, cycles and deeper categories are errors. Every board has 1–60 stable slots, including null holes. Empty newly created categories begin with one null slot.

## Migration and preservation

The shared parser accepts version 1 and explicitly constructs version 2 words with the same IDs, labels, phrases, symbols, colours, sizes, voice, rate and null slots. An existing Drink word stays a word. Only fresh starter boards contain a Drink demonstration category.

Local version 2 saves use `sayboard-v2`. When that key is absent, loading reads `sayboard-v1` and migrates in memory. The original version 1 bytes remain under their original key. A malformed version 2 board never triggers fallback to an older board or silently replaces saved data. Saving remains deliberate.

Export, import and account transfers carry the complete Board through the shared parser. Account revision handling is retained. PostgreSQL uses the deliberate, idempotent migration `backend/migrations/002_board_categories.sql` of its version-1-only payload constraint to accept legacy and category boards. Existing rows and revisions must remain unchanged. The migration sets the storage schema marker to 2; hosted readiness rejects an unmigrated database. Applying this migration remains an operator action; this change does not access or provision production databases. The existing 100 KB UTF-8 transport boundary remains for the complete account request. Compact board serialization is capped at 99 KB to reserve envelope space, and exports use that same compact serialization. Invalid or oversized saves must preserve the existing local/account copy.

## Editing and navigation

Category tiles have an Open accessible name and a visible category indicator. Word tiles retain Say accessible names. Back/Home navigation is in a consistent location in both communication and caregiver views. Returning from a category restores focus to its category tile. Category navigation stops current speech.

Caregivers add a category, edit its label/symbol/colour/slot, then open it to add/edit/reorder/remove child words. Explicit moves leave holes. Removing a category confirms that its child words will also be removed; the root slot stays empty. Save applies the complete draft. Loading/importing/resetting a different draft resets navigation to Home.

## Verification

Run `npm test` and `npm run --prefix backend check` for parser, migration, category editing and account roundtrip checks. Browser regressions are in `tests/` and run against the built app through `.github/workflows/frontend.yml`.
