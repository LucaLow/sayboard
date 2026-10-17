import { readFileSync, writeFileSync } from "node:fs";
const [input, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    "Usage: node profile-summary.mjs input.cpuprofile output.json",
  );
const profile = JSON.parse(readFileSync(input, "utf8"));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parents = new Map(
  profile.nodes.flatMap((n) => (n.children || []).map((id) => [id, n.id])),
);
const frames = new Map();
let total = 0;
let matching = 0;
let gc = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const duration = profile.timeDeltas[i];
  total += duration;
  const leaf = byId.get(profile.samples[i]);
  const frame = leaf.callFrame;
  const key = `${frame.functionName || "(anonymous)"} ${frame.url.replace("file://", "")}:${frame.lineNumber + 1}`;
  frames.set(key, (frames.get(key) || 0) + duration);
  if (frame.functionName === "(garbage collector)") gc += duration;
  for (let id = leaf.id; id; id = parents.get(id)) {
    if (byId.get(id).callFrame.functionName === "matchingSymbols") {
      matching += duration;
      break;
    }
  }
}
const result = {
  method:
    "Standalone Node --cpu-prof sampling of original catalogue benchmark. Profile instrumentation run excluded from timing comparisons. Sample attribution is approximate and V8 may inline split/sort builtins into anonymous catalogue frames.",
  totalSampledMs: total / 1000,
  matchingSymbolsInclusiveMs: matching / 1000,
  matchingSymbolsSamplePercent: (matching / total) * 100,
  garbageCollectionSamplePercent: (gc / total) * 100,
  topSelfFrames: [...frames]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([frame, duration]) => ({
      frame,
      sampledMs: duration / 1000,
      percent: (duration / total) * 100,
    })),
};
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
