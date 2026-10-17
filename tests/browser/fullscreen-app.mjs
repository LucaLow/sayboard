import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)("playwright");
const url = process.env.SAYBOARD_APP_URL || "http://127.0.0.1:5174/";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir("test-results/fullscreen", { recursive: true });
let checks = 0;
async function check(value, label) {
  assert.ok(await value, label);
  checks++;
}
async function active(p, value) {
  await p.waitForFunction(
    (v) =>
      document
        .querySelector("#app")
        .classList.contains("communication-fullscreen") === v,
    value,
  );
}
async function leave(p) {
  await p.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await p
    .getByRole("button", { name: "Leave fullscreen", exact: true })
    .click();
  await active(p, false);
}
const errors = [];
try {
  for (const [name, viewport, fallback] of [
    ["desktop", { width: 1280, height: 900 }, false],
    ["phone", { width: 390, height: 844 }, true],
    ["small-phone", { width: 320, height: 568 }, true],
  ]) {
    const p = await browser.newPage({
      viewport,
      isMobile: fallback,
      hasTouch: fallback,
    });
    const transfers = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (
        (r.method() === "POST" || r.method() === "PUT") &&
        new URL(r.url()).pathname.startsWith("/api/")
      )
        transfers.push(r.url());
    });
    await p.addInitScript(
      ({ fallback }) => {
        if (fallback)
          Object.defineProperty(document, "fullscreenEnabled", {
            value: false,
          });
        window.speechCalls = { speak: 0, cancel: 0 };
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
            cancel: () => {
              window.speechCalls.cancel++;
            },
            speak: (u) => {
              window.speechCalls.speak++;
              u.onstart?.();
            },
          },
        });
      },
      { fallback },
    );
    await p.goto(url);
    await p
      .getByRole("button", { name: "Enter fullscreen communication board" })
      .waitFor();
    const before = await p.evaluate(() => ({ ...localStorage }));
    const columns = await p
      .locator(".grid")
      .evaluate((n) => n.style.getPropertyValue("--board-columns"));
    for (let i = 0; i < 3; i++) {
      await p
        .getByRole("button", { name: "Enter fullscreen communication board" })
        .click();
      await active(p, true);
      if (!fallback)
        await p.waitForFunction(() => document.fullscreenElement?.id === "app");
      await check(
        p.getByRole("button", { name: "Caregiver controls" }).isHidden(),
        "caregiver hidden",
      );
      await check(
        p.locator(".header-controls").evaluate((n) => n.hidden && n.inert),
        "chrome inert",
      );
      await p.keyboard.press("Tab");
      await check(
        p.evaluate(() => !document.activeElement.closest(".header-controls")),
        "Tab skips hidden normal controls",
      );
      const rectBefore = await p.locator(".tile").first().boundingBox();
      await p.getByRole("button", { name: "Say Yes", exact: true }).click();
      await check(
        p
          .getByRole("button", { name: "Stop speaking", exact: true })
          .count()
          .then((n) => n === 0),
        "speech Stop panel removed",
      );
      await check(
        p
          .locator(".speechbar,.speech-actions")
          .count()
          .then((n) => n === 0),
        "speech panel absent",
      );
      await check(
        p.evaluate(
          () => window.speechCalls.speak > 0 && window.speechCalls.cancel > 0,
        ),
        "actual speech lifecycle invokes local speak and cancel",
      );
      assert.deepEqual(
        await p.locator(".tile").first().boundingBox(),
        rectBefore,
        "speech status retains tile position",
      );
      checks++;
      await p
        .getByRole("button", { name: "Open Drink category", exact: true })
        .focus();
      await p.keyboard.press("Enter");
      await check(
        p
          .getByRole("button", { name: "Back / Home", exact: true })
          .evaluate((n) => n === document.activeElement),
        "keyboard category focus",
      );
      await active(p, true);
      await p.getByRole("button", { name: "Say Water", exact: true }).click();
      await p.getByRole("button", { name: "Back / Home", exact: true }).click();
      await check(
        p
          .getByRole("button", { name: "Open Drink category", exact: true })
          .evaluate((n) => n === document.activeElement),
        "Back returns category focus",
      );
      await check(
        p
          .locator(".grid")
          .evaluate((n) => n.style.getPropertyValue("--board-columns"))
          .then((v) => v === columns),
        "fixed saved columns",
      );
      if (i === 1) {
        await p.keyboard.press("Escape");
        await active(p, false);
      } else await leave(p);
      await check(
        p
          .getByRole("button", { name: "Enter fullscreen communication board" })
          .evaluate((n) => n === document.activeElement),
        "exit entry focus",
      );
    }
    await p
      .getByRole("button", { name: "Enter fullscreen communication board" })
      .click();
    await active(p, true);
    if (fallback)
      for (const size of [{ width: 844, height: 390 }, viewport]) {
        await p.setViewportSize(size);
        await check(
          p
            .getByRole("button", { name: "Exit fullscreen", exact: true })
            .evaluate((n) => {
              const r = n.getBoundingClientRect();
              return r.right <= innerWidth && r.bottom <= innerHeight;
            }),
          "orientation exit reachable",
        );
      }
    await p.screenshot({ path: `test-results/fullscreen/app-${name}.png` });
    await leave(p);
    assert.deepEqual(
      await p.evaluate(() => ({ ...localStorage })),
      before,
      "fullscreen does not persist or alter local data",
    );
    checks++;
    await p.getByRole("button", { name: "Caregiver controls" }).click();
    await p
      .getByRole("button", { name: "Edit board and settings", exact: true })
      .click();
    await check(
      p.getByRole("button", { name: "Save board", exact: true }).isVisible(),
      "caregiver remains usable after exit",
    );
    await check(transfers.length === 0, "no uploads during communication");
    await p.close();
  }
  assert.deepEqual(errors, [], "no browser runtime errors");
  console.log(`Passed ${checks} integrated app browser assertions at ${url}`);
} finally {
  await browser.close();
}
