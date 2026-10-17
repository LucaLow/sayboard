// Synthetic text only. No voice model downloads, accounts or TLS bypass.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5197";
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir("test-results/type-and-speak", { recursive: true });
const word = {
  kind: "word",
  id: "typed-speech",
  label: "Fixture yes",
  phrase: "Yes",
  icon: "check",
  tone: "mint",
};
const fixture = {
  version: 2,
  voice: "fixture-local",
  rate: 1.15,
  size: "small",
  tiles: [word, null],
  subBoards: [],
};
const reports = [];
try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport,
        hasTouch: viewport.width < 500,
      });
      page.setDefaultTimeout(5000);
      const requests = [],
        errors = [];
      page.on("request", (r) =>
        requests.push(r.url() + " " + (r.postData() || "")),
      );
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(
        ({ fixture, theme }) => {
          if (!localStorage.getItem("sayboard-v2"))
            localStorage.setItem("sayboard-v2", JSON.stringify(fixture));
          localStorage.setItem("sayboard-theme", theme);
          Object.defineProperty(document, "fullscreenEnabled", {
            value: false,
          });
          window.__utterances = [];
          window.__cancels = 0;
          // Deterministic boundary spy exercises the real engine and speech callbacks.
          window.SpeechSynthesisUtterance = class {
            constructor(text) {
              this.text = text;
              this.voice = null;
              this.rate = 1;
            }
          };
          speechSynthesis.getVoices = () => [
            {
              name: "Fixture local voice",
              lang: "en-US",
              voiceURI: "fixture-local",
              localService: true,
              default: true,
            },
          ];
          speechSynthesis.cancel = () => {
            window.__cancels++;
          };
          speechSynthesis.speak = (u) => {
            window.__utterances.push({
              text: u.text,
              rate: u.rate,
              voice: u.voice.voiceURI,
            });
            u.onstart?.();
          };
        },
        { fixture, theme },
      );
      await page.goto(origin);
      const input = page.getByLabel("Type something to say", { exact: true });
      const speak = page.getByRole("button", { name: "Speak", exact: true });
      const before = await page.evaluate(() =>
        localStorage.getItem("sayboard-v2"),
      );
      assert.equal(await speak.isDisabled(), true);
      await input.fill("   ");
      await page.locator(".type-and-speak").evaluate((f) => f.requestSubmit());
      assert.equal(await page.evaluate(() => window.__utterances.length), 0);
      await input.fill("Fixture typed message");
      assert.equal(await page.evaluate(() => window.__utterances.length), 0);
      await input.press("Enter");
      assert.deepEqual(await page.evaluate(() => window.__utterances), [
        { text: "Fixture typed message", rate: 1.15, voice: "fixture-local" },
      ]);
      assert.equal(
        await page.locator(".tile.speaking").count(),
        0,
        "Typed speech must not highlight a tile with a matching id",
      );
      const cancels = await page.evaluate(() => window.__cancels);
      await speak.click();
      await speak.click();
      assert.equal(await page.evaluate(() => window.__utterances.length), 3);
      assert.ok((await page.evaluate(() => window.__cancels)) >= cancels + 2);
      // Composition commits text before Enter is allowed to submit.
      await input.evaluate((n) =>
        n.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        ),
      );
      assert.equal(await speak.isDisabled(), true);
      await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      await page.locator(".type-and-speak").evaluate((f) => f.requestSubmit());
      assert.equal(await page.evaluate(() => window.__utterances.length), 3);
      await input.evaluate((n) =>
        n.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        ),
      );
      await input.press("Enter");
      assert.equal(await page.evaluate(() => window.__utterances.length), 4);
      await page
        .getByRole("button", { name: "Say Fixture yes", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.__utterances.at(-1).text),
        "Yes",
      );
      assert.equal(await page.locator(".tile.speaking").count(), 1);
      await speak.click();
      assert.equal(await page.locator(".tile.speaking").count(), 0);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("sayboard-v2")),
        before,
      );
      assert.equal(
        await page.evaluate(() =>
          Object.values(localStorage).some((v) =>
            v.includes("Fixture typed message"),
          ),
        ),
        false,
      );
      assert.equal(
        requests.some((r) => r.includes("Fixture typed message")),
        false,
      );
      assert.equal(
        requests.some((r) => /huggingface|\.onnx/.test(r)),
        false,
      );
      assert.equal(
        await page
          .locator("#status")
          .evaluate((n) => getComputedStyle(n).position === "absolute"),
        true,
      );
      // Footer follows, rather than overlays, the board viewport in both presentations.
      for (const fullscreen of [false, true]) {
        if (fullscreen)
          await page
            .getByRole("button", {
              name: "Enter fullscreen communication board",
              exact: true,
            })
            .click();
        await input.scrollIntoViewIfNeeded();
        const geometry = await page.locator(".type-and-speak").evaluate((n) => {
          const b = n.getBoundingClientRect(),
            v = document
              .querySelector(".board-viewport")
              .getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            top: b.top,
            boardBottom: v.bottom,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.ok(geometry.top >= geometry.boardBottom - 1);
        assert.ok(geometry.left >= 0 && geometry.right <= viewport.width);
        assert.equal(geometry.overflow, false);
        // Emulate a reduced phone viewport while the keyboard is open.
        if (viewport.width < 500) {
          await page.setViewportSize({
            width: viewport.width,
            height: Math.min(400, viewport.height),
          });
          await input.focus();
          await input.scrollIntoViewIfNeeded();
          await input.fill("Fixture keyboard message");
          await speak.tap();
          assert.equal(
            await page.evaluate(() => window.__utterances.at(-1).text),
            "Fixture keyboard message",
          );
          await page.setViewportSize(viewport);
        }
        await input.focus();
        await input.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/type-and-speak/${theme}-${viewport.width}-${fullscreen ? "fullscreen" : "normal"}.png`,
        });
      }
      // Measure actual input text, label, button text, input edge and keyboard focus.
      const contrast = await page
        .locator(".type-and-speak")
        .evaluate((form) => {
          const rgb = (v) =>
            v
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number);
          const luminance = (c) =>
            c
              .map((v) => {
                v /= 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              })
              .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
          const ratio = (a, b) => {
            const x = luminance(a),
              y = luminance(b);
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };
          const bg = (n) => {
            for (; n; n = n.parentElement) {
              const c = getComputedStyle(n).backgroundColor;
              if (c !== "rgba(0, 0, 0, 0)") return rgb(c);
            }
            return [255, 255, 255];
          };
          const input = form.querySelector("input"),
            button = form.querySelector('button[type="submit"]'),
            label = form.querySelector("label");
          return {
            label: ratio(rgb(getComputedStyle(label).color), bg(label)),
            input: ratio(rgb(getComputedStyle(input).color), bg(input)),
            button: ratio(rgb(getComputedStyle(button).color), bg(button)),
            edge: ratio(rgb(getComputedStyle(input).borderTopColor), bg(input)),
            focus: ratio(rgb(getComputedStyle(input).outlineColor), bg(form)),
          };
        });
      for (const key of ["label", "input", "button"])
        assert.ok(contrast[key] >= 4.5, `${theme} ${key}: ${contrast[key]}`);
      for (const key of ["edge", "focus"])
        assert.ok(contrast[key] >= 3, `${theme} ${key}: ${contrast[key]}`);
      await page.reload();
      assert.equal(await input.inputValue(), "");
      assert.equal(await page.evaluate(() => window.__utterances.length), 0);
      assert.deepEqual(errors, []);
      reports.push({ viewport, theme, contrast, passed: true });
      await page.close();
    }
  }
  // Empty boards retain typed speech without requiring caregiver edits.
  const empty = await browser.newPage();
  await empty.addInitScript(() =>
    localStorage.setItem(
      "sayboard-v2",
      JSON.stringify({
        version: 2,
        voice: "",
        rate: 1,
        size: "small",
        tiles: [null],
        subBoards: [],
      }),
    ),
  );
  await empty.goto(origin);
  await empty.getByLabel("Type something to say", { exact: true }).waitFor();
  assert.equal(await empty.locator(".tile").count(), 0);
  await empty.close();
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
}
