// Exercise the free app with synthetic speech and unavailable account services.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5189";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "Use a local preview with synthetic data");
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: new URL(origin).protocol === "https:" });
  const externalRequests = [];
  const errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) {
      externalRequests.push(url.origin);
      return route.abort();
    }
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__freeSpeech = [];
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
    speechSynthesis.getVoices = () => [{
      name: "Synthetic local voice", voiceURI: "synthetic-local", localService: true, lang: "en-AU",
    }];
    speechSynthesis.speak = (utterance) => {
      window.__freeSpeech.push(utterance.text);
      utterance.onstart?.();
      utterance.onend?.();
    };
    speechSynthesis.cancel = () => {};
  });
  await page.goto(origin);
  assert.equal(await page.evaluate(() => localStorage.getItem("sayboard-v2")), null);
  await page.getByRole("button", { name: "Add tile to Home board", exact: true }).click();
  await page.getByRole("button", { name: "Continue to add tile", exact: true }).click();
  await page.getByLabel("Text on the tile", { exact: true }).fill("Free core demonstration");
  await page.getByRole("button", { name: "Save to board", exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sayboard-v2")));
  assert.ok(stored.tiles.some((tile) => tile?.label === "Free core demonstration"));
  await page.reload();
  await page.getByRole("button", { name: "Say Free core demonstration", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__freeSpeech), ["Free core demonstration"]);

  await page.getByRole("button", { name: "Caregiver controls", exact: true }).click();
  await page.getByRole("button", { name: "Edit board and settings", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Backup and transfer" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export board", exact: true }).click(),
  ]);
  assert.deepEqual(JSON.parse(await readFile(await download.path(), "utf8")), stored);
  assert.equal(await page.getByRole("button", { name: "Import board", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "Back to board", exact: true }).click();

  // This tests continued use after a network failure, not offline page startup.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Say Free core demonstration", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__freeSpeech.at(-1)), "Free core demonstration");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("sayboard-v2"))), stored);
  await page.getByRole("button", { name: "Add tile to Home board", exact: true }).click();
  await page.getByLabel("Text on the tile", { exact: true }).fill("Offline demonstration");
  await page.getByRole("button", { name: "Save to board", exact: true }).click();
  const offlineSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("sayboard-v2")));
  assert.ok(offlineSaved.tiles.some((tile) => tile?.label === "Free core demonstration"));
  assert.ok(offlineSaved.tiles.some((tile) => tile?.label === "Offline demonstration"));
  await page.getByRole("button", { name: "Say Offline demonstration", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__freeSpeech.at(-1)), "Offline demonstration");
  assert.deepEqual(externalRequests, [], "The free build must not require an external service");
  assert.deepEqual(errors, []);
  await mkdir("test-results/free-core", { recursive: true });
  const report = { localSave: true, reload: true, speechBoundary: true, exportMatchesSavedBoard: true, importAvailable: true, networkLossAfterLoad: true, localSaveWhileOffline: true, externalRequests, errors };
  await writeFile("test-results/free-core/report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
