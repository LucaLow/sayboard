// Run with Node >=24. Source is executed with Node's built-in type stripping.
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
const start = performance.now();
const { catalogue, searchSymbols, suggestSymbols } = await import(
  process.env.SAYBOARD_CATALOGUE_SOURCE || "../../src/catalogue.ts"
);
const importMs = performance.now() - start;
const queries = [
  "",
  "w",
  "wa",
  "water",
  "happy",
  "dog",
  "person",
  "heart",
  "zzzz",
  "red heart",
  "café",
  "🦮",
  "食べる",
];
const phrases = [
  "I need water please",
  "I do not want that",
  "It hurts",
  "all done",
  "I want to play music",
  "The quick brown fox jumps over the lazy dog",
];
let checksum = 0;
function time(fn, corpus, rounds) {
  const started = performance.now();
  for (let i = 0; i < rounds; i++)
    for (const text of corpus) checksum += fn(text).length;
  return (performance.now() - started) / (rounds * corpus.length);
}
const firstSearchMs = time(searchSymbols, queries, 1);
const firstSuggestionMs = time(suggestSymbols, phrases, 1);
// Warm-up is identical on both revisions. Seven independent batches follow.
time(searchSymbols, queries, 10);
time(suggestSymbols, phrases, 10);
const samples = Array.from({ length: 7 }, () => ({
  searchMs: time(searchSymbols, queries, 20),
  suggestMs: time(suggestSymbols, phrases, 20),
}));
const result = {
  node: process.version,
  entries: catalogue.length,
  importMs,
  firstSearchMs,
  firstSuggestionMs,
  queries,
  phrases,
  samples,
  checksum,
};
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
