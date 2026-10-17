import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

// UI-only checks. No model downloads, microphone use, or simulated mute detection.
const url = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5183/";
const results = [];
await mkdir("test-results/sound-help", { recursive: true });
for (const [engine, browserType] of [
  ["webkit", webkit],
  ["chromium", chromium],
]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const width of [320, 390, 1280])
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
          hasTouch: true,
        });
        page.setDefaultTimeout(5000);
        const errors = [],
          requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => requests.push(request.url()));
        await page.addInitScript((theme) => {
          localStorage.setItem("sayboard-theme", theme);
          window.__speechCalls = 0;
          speechSynthesis.speak = () => {
            window.__speechCalls++;
          };
        }, theme);
        await page.goto(url);
        const help = page.getByRole("button", {
          name: "No sound?",
          exact: true,
        });
        const dialog = page.getByRole("dialog", {
          name: "No sound?",
          exact: true,
        });
        assert.equal(await dialog.count(), 0, "No automatic mute warning");
        await help.waitFor();
        const original = await page.evaluate(() => ({
          storage: JSON.stringify({ ...localStorage }),
          audioType: navigator.audioSession?.type,
        }));
        const target = await help.boundingBox();
        assert.ok(
          target.width >= 44 && target.height >= 44,
          "Accessible help target",
        );
        assert.equal(await help.getAttribute("aria-haspopup"), "dialog");
        await page.locator("#typed-speech").fill("Synthetic draft stays here");
        await help.tap();
        await dialog.waitFor();
        assert.deepEqual(await dialog.locator("li").allTextContents(), [
          "Turn off Silent Mode.",
          "Turn up the media volume.",
          "Check Bluetooth/headphones.",
        ]);
        assert.ok(await dialog.getAttribute("aria-describedby"));
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement.textContent),
          "Close",
        );
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        assert.equal(
          await help.evaluate((node) => document.activeElement === node),
          true,
        );
        assert.equal(
          await page.locator("#typed-speech").inputValue(),
          "Synthetic draft stays here",
        );
        await help.tap();
        await page.touchscreen.tap(1, 1);
        await dialog.waitFor({ state: "detached" });
        await help.tap();
        await dialog.getByRole("button", { name: "Close", exact: true }).tap();
        await dialog.waitFor({ state: "detached" });
        // Resize before entering native fullscreen, which Chromium cannot resize.
        if (width < 500) await page.setViewportSize({ width, height: 340 });
        await page
          .getByRole("button", {
            name: "Enter fullscreen communication board",
            exact: true,
          })
          .tap();
        await page.waitForFunction(() =>
          document
            .querySelector("#app")
            .classList.contains("communication-fullscreen"),
        );
        const nativeFullscreen = await page.evaluate(
          () => !!document.fullscreenElement,
        );
        // A shortened viewport exercises the layout constraint of a phone keyboard.
        // Cloud browsers cannot validate the physical iOS keyboard itself.
        await help.tap();
        const bounds = await dialog.boundingBox();
        const viewport = page.viewportSize();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
        assert.equal(
          await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
          true,
        );
        await page.screenshot({
          path: `test-results/sound-help/${engine}-${theme}-${width}.png`,
        });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        assert.equal(
          await page
            .locator("#app")
            .evaluate((node) =>
              node.classList.contains("communication-fullscreen"),
            ),
          nativeFullscreen
            ? await page.evaluate(() => !!document.fullscreenElement)
            : true,
          "Escape closes help; native fullscreen follows the browser, in-page fullscreen stays active",
        );
        assert.equal(
          await page.locator("#typed-speech").inputValue(),
          "Synthetic draft stays here",
        );
        assert.deepEqual(
          await page.evaluate(() => ({
            storage: JSON.stringify({ ...localStorage }),
            audioType: navigator.audioSession?.type,
          })),
          original,
        );
        assert.equal(await page.evaluate(() => window.__speechCalls), 0);
        assert.equal(
          requests.some((request) =>
            /huggingface|kokoro\.worker|ort-wasm/.test(request),
          ),
          false,
        );
        assert.deepEqual(errors, []);
        results.push({ engine, theme, width, passed: true });
        await page.close();
      }
  } finally {
    await browser.close();
  }
}
await writeFile(
  "test-results/sound-help/results.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
