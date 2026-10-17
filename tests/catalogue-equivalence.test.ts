import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import baseline from "./fixtures/catalogue-baseline.json" with { type: "json" };
import {
  catalogue,
  getEmojiGlyph,
  getIconNode,
  searchSymbols,
  suggestSymbols,
} from "../src/catalogue";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Oracle recorded from main at baseline.sourceCommit before the performance edits.
// Compare real ordered outputs, including every symbol's metadata and drawing.
describe("catalogue behavior matches the pre-optimization board", () => {
  it("preserves every entry, alias, SVG node and emoji glyph in order", () => {
    expect(hash(catalogue)).toBe(baseline.catalogueHash);
    expect(
      hash(
        catalogue.map((entry) => [
          entry.id,
          getIconNode(entry.id),
          getEmojiGlyph(entry.id),
        ]),
      ),
    ).toBe(baseline.symbolHash);
  });

  it("preserves exact ranked search and suggestion outputs", () => {
    const kinds = ["all", "icon", "emoji"] as const;
    for (const { query, searchHashes, suggestionHash } of baseline.results) {
      for (const [index, kind] of kinds.entries()) {
        expect(
          hash(searchSymbols(query, kind).map((entry) => entry.id)),
          `${kind} search ${JSON.stringify(query)}`,
        ).toBe(searchHashes[index]);
      }
      expect(
        hash(suggestSymbols(query).map((entry) => entry.id)),
        `suggestions ${JSON.stringify(query)}`,
      ).toBe(suggestionHash);
    }
  }, 60000);
});
