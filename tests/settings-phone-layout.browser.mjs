// Synthetic fixtures only. Never loads speech models, opens files or bypasses TLS.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5197";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
await mkdir("test-results/settings-phone", { recursive: true });
const results = [];
try {
  for (const width of [320, 375, 390, 414, 540, 768])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        hasTouch: true,
      });
      page.setDefaultTimeout(5000);
      const errors = [],
        requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => requests.push(r.url()));
      await page.addInitScript((theme) => {
        localStorage.setItem("sayboard-theme", theme);
        localStorage.setItem(
          "sayboard-v2",
          JSON.stringify({
            version: 2,
            voice: "",
            rate: 0.85,
            size: "small",
            tiles: [
              {
                kind: "word",
                id: "fixture",
                label: "Fixture word",
                phrase: "Fixture word",
                icon: "check",
                tone: "mint",
              },
            ],
            subBoards: [],
          }),
        );
        window.__speechCalls = 0;
        speechSynthesis.speak = () => {
          window.__speechCalls++;
        };
      }, theme);
      await page.goto(origin);
      const original = await page.evaluate(() =>
        localStorage.getItem("sayboard-v2"),
      );
      await page
        .getByRole("button", { name: "Caregiver controls", exact: true })
        .tap();
      await page
        .getByRole("button", { name: "Edit board and settings", exact: true })
        .tap();
      for (const summary of await page
        .locator(".settings-group > summary")
        .all()) {
        await summary.tap();
        assert.equal(await summary.evaluate((n) => n.parentElement.open), true);
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const panel = page.locator(".local-speech-controls");
      const controls = await panel
        .locator("button:not([hidden])")
        .evaluateAll((ns) =>
          ns.map((n) => ({
            text: n.textContent,
            height: n.getBoundingClientRect().height,
            width: n.getBoundingClientRect().width,
          })),
        );
      assert.ok(
        controls.every((c) => c.height >= 48 && c.width >= 44),
        JSON.stringify(controls),
      );
      const links = await panel.locator("a").evaluateAll((ns) =>
        ns.map((n) => ({
          top: n.getBoundingClientRect().top,
          bottom: n.getBoundingClientRect().bottom,
          left: n.getBoundingClientRect().left,
          right: n.getBoundingClientRect().right,
          href: n.getAttribute("href"),
        })),
      );
      assert.ok(
        links[1].top >= links[0].bottom + 10,
        "Source links must have distinct, spaced rows",
      );
      assert.deepEqual(
        links.map((n) => n.href),
        ["/tts-notices.txt", "/source/index.html"],
      );
      assert.equal(
        await panel
          .locator("button[hidden]")
          .evaluateAll((ns) =>
            ns.every((n) => getComputedStyle(n).display === "none"),
          ),
        true,
      );
      const geometry = await panel.evaluate((n) => {
        const b = n.getBoundingClientRect(),
          container = n.closest(".settings").getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          width: b.width,
          containerWidth: container.width,
        };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= width);
      assert.ok(
        geometry.width >= geometry.containerWidth - 50,
        "Voice controls should span the settings grid",
      );
      await panel.locator("a").first().focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute("href")),
        "/source/index.html",
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        "Download / load local voice",
      );
      await page
        .getByRole("button", {
          name: "Download / load local voice",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/settings-phone/after-local-${theme}-${width}.png`,
      });
      const ratios = await panel.evaluate((n) => {
        const rgb = (v) =>
          v
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
        const lum = (c) =>
          c
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a, b) =>
          (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        const button = n.querySelector("button"),
          link = n.querySelector("a"),
          s = getComputedStyle(button),
          surface = rgb(
            getComputedStyle(n.closest(".settings")).backgroundColor,
          );
        return {
          buttonText: ratio(rgb(s.color), rgb(s.backgroundColor)),
          buttonEdge: ratio(rgb(s.borderTopColor), rgb(s.backgroundColor)),
          linkText: ratio(rgb(getComputedStyle(link).color), surface),
        };
      });
      assert.ok(
        ratios.buttonText >= 4.5 &&
          ratios.linkText >= 4.5 &&
          ratios.buttonEdge >= 3,
        JSON.stringify(ratios),
      );
      await page
        .getByRole("button", { name: "Add word or phrase", exact: true })
        .tap();
      await page
        .getByLabel("Text on the tile", { exact: true })
        .fill("Fixture edited word");
      await page.getByText("Find another symbol", { exact: true }).tap();
      await page.getByText("Colour and board position", { exact: true }).tap();
      const modal = await page.locator("dialog[open]").evaluate((n) => ({
        left: n.getBoundingClientRect().left,
        right: n.getBoundingClientRect().right,
        width: n.clientWidth,
        scrollWidth: n.scrollWidth,
      }));
      assert.ok(
        modal.left >= 0 &&
          modal.right <= width &&
          modal.scrollWidth <= modal.width,
      );
      await page
        .getByRole("button", { name: "Add to board draft", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/settings-phone/after-modal-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).tap();
      await page
        .getByRole("button", { name: "Discard changes", exact: true })
        .tap();
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("sayboard-v2")),
        original,
      );
      assert.equal(await page.evaluate(() => window.__speechCalls), 0);
      assert.equal(
        requests.some((r) => /huggingface|\.onnx/.test(r)),
        false,
      );
      assert.deepEqual(errors, []);
      results.push({ width, theme, controls, ratios, passed: true });
      await page.close();
    }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
