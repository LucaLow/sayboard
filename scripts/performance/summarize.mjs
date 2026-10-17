import { readFileSync } from "node:fs";
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = (values) => ({
  median: median(values),
  min: Math.min(...values),
  max: Math.max(...values),
});
for (const path of process.argv.slice(2)) {
  const result = JSON.parse(readFileSync(path, "utf8"));
  if (!result.samples[0].profile) {
    console.log(
      JSON.stringify({
        path,
        importMs: result.importMs,
        firstSearchMs: result.firstSearchMs,
        firstSuggestionMs: result.firstSuggestionMs,
        searchMs: stats(result.samples.map((s) => s.searchMs)),
        suggestMs: stats(result.samples.map((s) => s.suggestMs)),
      }),
    );
    continue;
  }
  const groups = Map.groupBy(
    result.samples,
    (s) => `${s.profile}-${s.tiles}-${s.cache}`,
  );
  for (const [group, samples] of groups) {
    const summary = {};
    for (const key of [
      "domContentLoadedMs",
      "fcpMs",
      "lcpMs",
      "scriptMs",
      "taskMs",
      "initialJsDecodedBytes",
      "initialJsTransferBytes",
      "tileSpeechDispatchMs",
      "editorOpenMs",
      "pickerOpenMs",
      "categoryMs",
      "searchMs",
    ]) {
      const values = samples
        .map((s) => (Array.isArray(s[key]) ? median(s[key]) : s[key]))
        .filter(Number.isFinite);
      if (values.length) summary[key] = stats(values);
    }
    console.log(
      JSON.stringify({
        path,
        group,
        samples: samples.length,
        errors: samples.flatMap((s) => s.errors),
        ...summary,
      }),
    );
  }
}
