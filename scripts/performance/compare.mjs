import { readFileSync, writeFileSync } from "node:fs";
const [
  baselinePath,
  candidatePath,
  baselineCataloguePath,
  candidateCataloguePath,
  output,
] = process.argv.slice(2);
if (!output)
  throw new Error(
    "Usage: node compare.mjs baseline-browser.json candidate-browser.json baseline-catalogue.json candidate-catalogue.json report.md",
  );
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const [baseline, candidate, baselineCatalogue, candidateCatalogue] = [
  baselinePath,
  candidatePath,
  baselineCataloguePath,
  candidateCataloguePath,
].map(read);
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = (values) => ({
  median: median(values),
  min: Math.min(...values),
  max: Math.max(...values),
});
const format = (value) =>
  `${value.median.toFixed(2)} [${value.min.toFixed(2)}, ${value.max.toFixed(2)}]`;
const change = (a, b) => `${((b.median / a.median - 1) * 100).toFixed(1)}%`;
const lines = [
  "# Sayboard performance comparison",
  "",
  "Baseline: `2a63e8d6aa20d7328ce98afdf24d6240898f827f`. Candidate: catalogue-only optimization in this PR. Method and reproduction commands are in [README.md](../README.md).",
  "",
  "All times are milliseconds. Each cell gives median [minimum, maximum] across seven measured samples. Negative change means less time. Browser search/category samples are medians of fixed within-page batches. Small overlapping differences are inconclusive.",
  "",
  `Environment: ${candidate.environment.cpu}, ${candidate.environment.platform}/${candidate.environment.arch}, Node ${candidate.node}, Chromium ${candidate.browser}.`,
  "",
  "## Catalogue source benchmark",
  "",
  "| Operation | Baseline | Candidate | Median change |",
  "| --- | ---: | ---: | ---: |",
];
for (const key of ["searchMs", "suggestMs"]) {
  const a = stats(baselineCatalogue.samples.map((s) => s[key]));
  const b = stats(candidateCatalogue.samples.map((s) => s[key]));
  lines.push(`| ${key} | ${format(a)} | ${format(b)} | ${change(a, b)} |`);
}
lines.push(
  "",
  "## Browser measurements",
  "",
  "| Scenario | Measurement | Baseline | Candidate | Median change |",
  "| --- | --- | ---: | ---: | ---: |",
);
const group = (s) => `${s.profile}, ${s.tiles} tiles, ${s.cache}`;
for (const [name, before] of Map.groupBy(baseline.samples, group)) {
  const after = candidate.samples.filter((s) => group(s) === name);
  for (const key of [
    "scriptMs",
    "lcpMs",
    "pickerOpenMs",
    "searchMs",
    "categoryMs",
    "tileSpeechDispatchMs",
  ]) {
    const metric = (s) => (Array.isArray(s[key]) ? median(s[key]) : s[key]);
    const a = stats(before.map(metric));
    const b = stats(after.map(metric));
    lines.push(
      `| ${name} | ${key} | ${format(a)} | ${format(b)} | ${change(a, b)} |`,
    );
  }
}
const a = baseline.samples[0];
const b = candidate.samples[0];
lines.push(
  "",
  "## Payload and interpretation",
  "",
  `Initial JavaScript decoded bytes: ${a.initialJsDecodedBytes} → ${b.initialJsDecodedBytes}. Cold Resource Timing JavaScript transfer bytes, including response overhead: ${a.initialJsTransferBytes} → ${b.initialJsTransferBytes}. Warm HTTP cache transfers zero bytes in both revisions. The full icon/emoji catalogue remains available.`,
  "",
  "The optimization caches token arrays during search and reduces repeated filtering and ranking work. Normalized index construction still happens during startup. First picker-open measurements include filling the token caches and are reported alongside warm input-handler results. Category rendering and speech implementation are unchanged; timing variations there are control measurements, not claimed improvements. No initial-load improvement is claimed.",
  "",
  "Local paint measurements include request-time gzip CPU work and OS scheduling. They are not production user percentiles or mobile-network measurements. Device speech is stubbed to prove synchronous dispatch; no speech quality or audible-startup improvement is claimed. See README limits and separate functional regression evidence.",
  "",
);
writeFileSync(output, lines.join("\n"));
