// Synthetic cloud integration. No accounts, uploads, filechooser/export or TLS bypass.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launchPersistentContext(
  process.env.SAYBOARD_TEST_PROFILE || "",
  {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  },
);
const page = await browser.newPage();
const requests = [];
// Chromium may retrieve its declared touch icon after playback; that static request is not inference.
const speechRequests = () =>
  requests.filter(
    (request) => new URL(request.url).pathname !== "/apple-touch-icon.png",
  );
const errors = [];
page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.deviceSpeech = [];
  let timer;
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      getVoices: () => [
        {
          voiceURI: "test-local",
          name: "Synthetic local",
          lang: "en-US",
          localService: true,
          default: true,
        },
      ],
      addEventListener: () => {},
      cancel: () => clearTimeout(timer),
      speak: (u) => {
        window.deviceSpeech.push({ text: u.text, at: performance.now() });
        u.onstart?.();
        timer = setTimeout(() => u.onend?.(), 20);
      },
    },
  });
});
try {
  await page.goto(process.env.SAYBOARD_APP_URL || "http://127.0.0.1:5185");
  assert.equal(
    requests.some((r) => /huggingface|kokoro.worker|ort-wasm/.test(r.url)),
    false,
  );
  // Keep this synthetic board small enough to prepare within the admission budget.
  await page.getByRole("button", { name: "Say Yes", exact: true }).click();
  await page.waitForFunction(() => window.deviceSpeech.length === 1);
  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem("sayboard-v2"));
    if (b) {
      b.tiles = b.tiles.filter(
        (t) => t?.kind === "word" && ["Yes", "No", "Help"].includes(t.phrase),
      );
      b.subBoards = [];
      localStorage.setItem("sayboard-v2", JSON.stringify(b));
    }
  });
  // starter boards are only stored after Save, so simply prepare common phrases here.
  await page
    .getByRole("button", { name: "Caregiver controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit board and settings", exact: true })
    .click();
  await page.getByText("Voice and speaking speed", { exact: true }).click();
  const load = page.getByRole("button", {
    name: "Download / load local voice",
    exact: true,
  });
  await load.click();
  await page.getByRole("button", { name: "Test voice", exact: true }).click();
  await page.waitForFunction(() =>
    window.deviceSpeech.some((x) => x.text === "This is my voice."),
  );
  await page
    .getByText("Local voice ready.", { exact: false })
    .waitFor({ timeout: 180000 });
  await page.waitForLoadState("networkidle");
  const start = speechRequests().length;
  await page
    .getByRole("button", { name: "Prepare five common phrases", exact: true })
    .click();
  await page
    .getByText("Five common phrases are ready", { exact: false })
    .waitFor({ timeout: 90000 });
  assert.equal(
    speechRequests().length,
    start,
    "phrase preparation makes no network requests",
  );
  const deviceBefore = await page.evaluate(() => window.deviceSpeech.length);
  await page
    .getByRole("button", { name: "Back to board", exact: true })
    .click();
  assert.equal(await page.locator(".speechbar,.speech-actions").count(), 0);
  await page.waitForLoadState("networkidle");
  const playbackRequests = speechRequests().length;
  await page.getByRole("button", { name: "Say Yes", exact: true }).click();
  await page
    .locator("#status")
    .filter({ hasText: "Said: Yes" })
    .waitFor({ timeout: 5000 });
  const deviceAfterActivation = await page.evaluate(
    () => window.deviceSpeech.length,
  );
  assert.ok(
    deviceAfterActivation <= deviceBefore + 1,
    "First tap may use device speech while audio resumes",
  );
  await page.getByRole("button", { name: "Say Yes", exact: true }).click();
  await page
    .locator("#status")
    .filter({ hasText: "Said: Yes" })
    .waitFor({ timeout: 5000 });
  assert.equal(
    await page.evaluate(() => window.deviceSpeech.length),
    deviceAfterActivation,
    "prepared tap with running audio uses actual model PCM",
  );
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Say No", exact: true }).click();
  await page.getByRole("button", { name: "Say Help", exact: true }).click();
  await page
    .locator("#status")
    .filter({ hasText: "Said: Help" })
    .waitFor({ timeout: 5000 });
  assert.equal(await page.locator(".tile.speaking").count(), 0);
  await writeFile(
    "test-results/tts-app-requests.json",
    JSON.stringify({ requests, playbackRequests, start }, null, 2),
  );
  assert.equal(
    speechRequests().length,
    playbackRequests,
    "speech has no network",
  );
  assert.ok(requests.every((r) => r.method === "GET"));
  assert.deepEqual(errors, []);
  console.log(
    "Integrated app: explicit download, device speech during loading, actual prepared model playback, offline rapid taps and hidden announcements passed.",
  );
} finally {
  await browser.close();
}
