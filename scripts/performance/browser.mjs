// Local production-build measurements. No accounts, model downloads, or external writes.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { cpus, platform, arch } from "node:os";
const output = resolve(
  process.argv[2] || "test-results/performance/current.json",
);
mkdirSync(resolve(output, ".."), { recursive: true });
const directory = resolve(process.env.SAYBOARD_DIST || "dist");
const server = createServer((req, res) => {
  const path = resolve(
    directory,
    "." + new URL(req.url, "http://localhost").pathname,
  );
  if (!path.startsWith(directory + "/") && path !== directory) {
    res.writeHead(403).end();
    return;
  }
  try {
    const file = statSync(path).isDirectory()
      ? resolve(path, "index.html")
      : path;
    const bytes = readFileSync(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      }[extname(file)] || "application/octet-stream",
    );
    res.setHeader(
      "Cache-Control",
      file.endsWith(".html") ? "no-cache" : "public, max-age=3600",
    );
    res.setHeader("Content-Encoding", "gzip");
    res.end(gzipSync(bytes));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const profiles = [
  { name: "desktop", viewport: { width: 1280, height: 900 }, throttle: 1 },
  { name: "mobile", viewport: { width: 390, height: 844 }, throttle: 4 },
];
const samples = [];
const fixture = (count) => {
  const words = Array.from({ length: count }, (_, i) => ({
    kind: "word",
    id: `w${i}`,
    label: `Word ${i}`,
    phrase: `Word ${i}`,
    icon: "heart",
    tone: "mint",
  }));
  words[0] = {
    ...words[0],
    kind: "category",
    label: "Drinks",
    subBoardId: "drinks",
  };
  return {
    version: 2,
    size: "standard",
    rate: 0.85,
    voice: "",
    tiles: words,
    subBoards: [
      {
        id: "drinks",
        size: "standard",
        tiles: words.slice(1).map((t) => ({ ...t, id: "child-" + t.id })),
      },
    ],
  };
};
try {
  for (const profile of profiles)
    for (const count of [20, 60])
      for (let repetition = 0; repetition < 7; repetition++) {
        const context = await browser.newContext({
          viewport: profile.viewport,
          hasTouch: profile.name === "mobile",
        });
        await context.addInitScript((board) => {
          localStorage.setItem("sayboard-v2", JSON.stringify(board));
          window.__speechCalls = [];
          Object.defineProperty(window, "speechSynthesis", {
            value: {
              cancel() {},
              getVoices: () => [
                {
                  voiceURI: "benchmark-local",
                  name: "Benchmark local",
                  lang: "en-US",
                  localService: true,
                  default: true,
                },
              ],
              addEventListener() {},
              speak(u) {
                window.__speechCalls.push(performance.now());
                u.onstart?.();
                u.onend?.();
              },
            },
          });
          window.SpeechSynthesisUtterance = class {
            constructor(text) {
              this.text = text;
            }
          };
          window.__lcp = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              window.__lcp = entry.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }, fixture(count));
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", {
          rate: profile.throttle,
        });
        await cdp.send("Performance.enable");
        for (const cache of ["cold", "warm"]) {
          if (cache === "cold") await page.goto(origin);
          else await page.reload();
          await page.locator(".tile").first().waitFor();
          assert.equal(await page.locator(".tile").count(), count);
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          const load = await page.evaluate(() => ({
            domContentLoadedMs:
              performance.getEntriesByType("navigation")[0]
                .domContentLoadedEventEnd,
            fcpMs:
              performance.getEntriesByName("first-contentful-paint")[0]
                ?.startTime ?? null,
            lcpMs: window.__lcp,
            initialJsDecodedBytes: performance
              .getEntriesByType("resource")
              .filter((e) => e.name.endsWith(".js"))
              .reduce((sum, e) => sum + e.decodedBodySize, 0),
            initialJsTransferBytes: performance
              .getEntriesByType("resource")
              .filter((e) => e.name.endsWith(".js"))
              .reduce((sum, e) => sum + e.transferSize, 0),
          }));
          const after = (await cdp.send("Performance.getMetrics")).metrics;
          // CDP counters reset for each navigation. Read current document counters.
          const metric = (name) =>
            after.find((m) => m.name === name)?.value ?? 0;
          const interactions = await page.evaluate(() => {
            const measure = (fn) => {
              const start = performance.now();
              fn();
              return performance.now() - start;
            };
            const categoryMs = [];
            for (let i = 0; i < 30; i++)
              categoryMs.push(
                measure(() => {
                  document.querySelector(".category-tile").click();
                  document.querySelector(".board-home").click();
                }),
              );
            const tileSpeechDispatchMs = measure(() =>
              document.querySelector(".tile:not(.category-tile)").click(),
            );
            const speechInvoked = window.__speechCalls.length > 0;
            const editorOpenMs = measure(() => {
              document.querySelector(".caregiver-access").click();
              [...document.querySelectorAll("dialog button")]
                .find((b) => b.textContent === "Edit board and settings")
                .click();
            });
            const pickerOpenMs = measure(() =>
              [...document.querySelectorAll(".edit-row button")]
                .find((b) => b.textContent === "Edit Word 1")
                .click(),
            );
            const search = document.querySelector(
              ".symbol-picker input[type=search]",
            );
            const searchMs = [];
            for (let i = 0; i < 3; i++)
              for (const query of [
                "",
                "w",
                "water",
                "person",
                "heart",
                "red heart",
                "zzzz",
              ]) {
                searchMs.push(
                  measure(() => {
                    search.value = query;
                    search.dispatchEvent(new Event("input", { bubbles: true }));
                  }),
                );
              }
            return {
              categoryMs,
              tileSpeechDispatchMs,
              speechInvoked,
              editorOpenMs,
              pickerOpenMs,
              searchMs,
            };
          });
          assert.equal(interactions.speechInvoked, true);
          assert.deepEqual(errors, []);
          samples.push({
            profile: profile.name,
            cpuThrottle: profile.throttle,
            tiles: count,
            repetition,
            cache,
            ...load,
            scriptMs: metric("ScriptDuration") * 1000,
            taskMs: metric("TaskDuration") * 1000,
            ...interactions,
            errors,
          });
          if (repetition === 0 && cache === "cold")
            await page.screenshot({
              path: output.replace(/\.json$/, `-${profile.name}-${count}.png`),
              fullPage: true,
            });
        }
        await context.close();
        console.log(`${profile.name} ${count} ${repetition + 1}/7`);
      }
  const result = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    node: process.version,
    environment: { platform: platform(), arch: arch(), cpu: cpus()[0].model },
    method:
      "Local gzip HTTP production build; fresh context cold then HTTP-cache warm reload; desktop 1x / mobile 4x CPU; 7 repetitions per 20/60 tile board; OS speech stubbed; category synchronous handler roundtrips include DOM recreation but exclude paint. Search measures synchronous input handlers across the fixed corpus, three rounds. CDP counters are per document, captured before interaction.",
    samples,
  };
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
} finally {
  await browser.close();
  server.close();
}
