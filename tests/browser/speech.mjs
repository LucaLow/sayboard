import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Explicit test command: downloads about 93 MB of public model assets. Never use real user phrases.
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("npx", args, { stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Command exited ${code}`)),
    );
  });
await run(["vite", "build", "--config", "tests/browser/vite.config.mjs"]);
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--outDir",
    "test-results/browser",
    "--host",
    "127.0.0.1",
    "--port",
    "5180",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Test server timeout")),
      10000,
    );
    server.stdout.on("data", (bytes) => {
      if (bytes.toString().includes("5180")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("Test server exited"));
    });
  });
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({});
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  const url = "http://127.0.0.1:5180/tests/browser/speech.html";
  await page.goto(url);
  assert.equal(
    requests.some((request) =>
      /huggingface|kokoro.worker|ort-wasm/.test(request.url),
    ),
    false,
    "No runtime/model download before consent",
  );
  const load = page.getByRole("button", {
    name: "Download / load local voice",
  });
  await load.click();
  await page.getByRole("button", { name: "Cancel voice download" }).click();
  await page
    .getByText("Local voice is not loaded.", { exact: false })
    .waitFor();
  await page.waitForTimeout(200);
  const started = performance.now();
  await load.click();
  await page
    .getByText("Local voice ready.", { exact: false })
    .waitFor({ timeout: 180000 });
  const coldLoadMs = performance.now() - started;
  const rawInference = [];
  for (const text of ["Yes", "No", "Help", "Stop", "I need water"]) {
    rawInference.push(
      await page.evaluate(async (text) => {
        const started = performance.now();
        const audio = await window.generateSample(text);
        return {
          text,
          latencyMs: performance.now() - started,
          sampleRate: audio.sampleRate,
          samples: Array.from(audio.samples),
        };
      }, text),
    );
  }
  // Uncached AAC taps use synthetic device fallback immediately in this headless test.

  const inferenceRequestStart = requests.length;
  for (const [id, text] of [
    ["yes", "Yes"],
    ["no", "No"],
    ["help", "Help"],
    ["water", "I need water"],
    ["yes", "Yes"],
  ]) {
    await page.locator("#output").evaluate((node) => (node.textContent = ""));
    await page.locator(`#${id}`).click();
    await page
      .locator("#output")
      .filter({ hasText: `Said: ${text}` })
      .waitFor({ timeout: 40000 });
  }
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/aac-raw.json", JSON.stringify(rawInference));
  const measured = await page.evaluate(() => window.results);
  assert.equal(measured.length, 5);
  assert.ok(
    measured.every((result) => result.latencyMs < 1500),
    "Audible output starts promptly",
  );
  assert.ok(
    (await page.evaluate(() => window.fallbacks)).length >= 4,
    "Slow uncached model uses device fallback",
  );
  assert.equal(
    requests.length,
    inferenceRequestStart,
    "All inference remains offline",
  );
  // Rapid taps suppress the old output and keep only the latest pending phrase.
  await page.evaluate(() => {
    window.results = [];
  });
  await page.locator("#yes").click();
  await page.locator("#stop").click();
  await page.waitForTimeout(1800);
  assert.equal(await page.locator("#output").textContent(), "Stopped");
  await page.reload();
  assert.equal(
    await page.locator("select").inputValue(),
    "model",
    "Choice survives reload",
  );
  const cachedStart = requests.length;
  const warmStart = performance.now();
  await load.click();
  await page
    .getByText("Local voice ready.", { exact: false })
    .waitFor({ timeout: 180000 });
  const cachedLoadMs = performance.now() - warmStart;
  assert.equal(
    requests
      .slice(cachedStart)
      .some((request) => request.url.includes("huggingface")),
    false,
    "Pinned assets reuse bounded model cache",
  );
  await context.setOffline(true);
  await page.locator("#no").click();
  await page.locator("#help").click();
  await page.locator("#water").click();
  await page
    .locator("#output")
    .filter({ hasText: "Said: I need water" })
    .waitFor({ timeout: 40000 });
  const rapid = await page.evaluate(() => window.results);
  assert.deepEqual(
    rapid.slice(-1).map((result) => result.text),
    ["I need water"],
  );
  await context.setOffline(false);
  await page.reload();
  await load.click();
  await page
    .getByText("Local voice ready.", { exact: false })
    .waitFor({ timeout: 180000 });
  const prepare = page.getByRole("button", {
    name: "Prepare five common phrases",
  });
  await prepare.click();
  await page.getByRole("button", { name: "Stop phrase preparation" }).click();
  await page
    .getByText("Preparation stopped.", { exact: false })
    .waitFor({ timeout: 40000 });
  const preparationRequests = requests.length;
  const prepStart = performance.now();
  await prepare.click();
  await page
    .getByText("Five common phrases are ready", { exact: false })
    .waitFor({ timeout: 90000 });
  const prewarmMs = performance.now() - prepStart;
  for (const [id, text] of [
    ["yes", "Yes"],
    ["no", "No"],
    ["help", "Help"],
    ["stop-word", "Stop"],
    ["water", "I need water"],
  ]) {
    await page.locator("#output").evaluate((node) => (node.textContent = ""));
    await page.locator(`#${id}`).click();
    await page
      .locator("#output")
      .filter({ hasText: `Said: ${text}` })
      .waitFor({ timeout: 5000 });
  }
  const prewarmed = await page.evaluate(() => window.results);
  assert.equal(prewarmed.length, 5);
  await page.evaluate(() => {
    window.results = [];
    window.speechEngine.speak("Please wait", {
      onStart: () => window.results.push({ text: "Please wait" }),
    });
  });
  await page.locator("#yes").click();
  await page
    .locator("#output")
    .filter({ hasText: "Said: Yes" })
    .waitFor({ timeout: 5000 });
  const cachedDuringInference = await page.evaluate(() => window.results);
  assert.deepEqual(
    cachedDuringInference.slice(-1).map((result) => result.text),
    ["Yes"],
  );
  assert.ok(
    cachedDuringInference.at(-1).latencyMs < 500,
    "Cached taps bypass obsolete inference",
  );
  assert.equal(
    requests.length,
    preparationRequests,
    "Prewarming has no text/audio network requests",
  );
  await page.locator("select").selectOption("system");
  await page.reload();
  assert.equal(await page.locator("select").inputValue(), "system");
  const cache = await page.evaluate(async () => {
    const entries = [];
    for (const name of await caches.keys())
      if (name.startsWith("sayboard-tts-")) {
        const store = await caches.open(name);
        const keys = await store.keys();
        let bytes = 0;
        for (const key of keys)
          bytes += (await (await store.match(key)).arrayBuffer()).byteLength;
        entries.push({ name, entries: keys.length, bytes });
      }
    return entries;
  });
  assert.ok(
    cache.reduce((total, entry) => total + entry.bytes, 0) <= 100 * 1024 * 1024,
  );
  assert.ok(requests.every((request) => request.method === "GET"));
  assert.deepEqual(errors, []);
  const hardware = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
  }));
  await mkdir("test-results", { recursive: true });
  const report = {
    hardware,
    coldLoadMs,
    rawInference: rawInference.map(({ samples, ...rest }) => ({
      ...rest,
      sampleCount: samples.length,
    })),
    cachedLoadMs,
    measured,
    rapid,
    prewarmMs,
    prewarmed,
    cachedDuringInference,
    cache,
    requests,
    errors,
    tlsValidationEnabled: true,
  };
  await writeFile(
    "test-results/speech-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { ...report, requests: `${requests.length} asset requests` },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
