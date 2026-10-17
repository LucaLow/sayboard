import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Real computed styles, sRGB linearization and alpha compositing, WCAG 2.2 ratios.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"],
});
const url = process.env.SAYBOARD_APP_URL || "http://127.0.0.1:5174/";
const records = [];
await mkdir("test-results/contrast", { recursive: true });
async function audit(page, state, theme) {
  const results = await page.evaluate(() => {
    const rgba = (value) => {
      const n = value.match(/[\d.]+/g).map(Number);
      return [...n.slice(0, 3), n[3] ?? 1];
    };
    const over = (a, b) => [
      ...a.slice(0, 3).map((c, i) => c * a[3] + b[i] * (1 - a[3])),
      1,
    ];
    const bg = (node) => {
      if (!node) return [255, 255, 255, 1];
      return over(
        rgba(getComputedStyle(node).backgroundColor),
        bg(node.parentElement),
      );
    };
    const lum = (c) =>
      c
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) =>
      (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const visible = (n) =>
      n.getClientRects().length &&
      getComputedStyle(n).visibility !== "hidden" &&
      !n.closest(".sr-only,[hidden]") &&
      !n.closest("button:disabled");
    const modal = document.querySelector("dialog[open]");
    const nodes = [...(modal || document.body).querySelectorAll("*")].filter(
      visible,
    );
    const out = [];
    const add = (n, kind, a, b, min) =>
      out.push({
        element: n.tagName.toLowerCase() + "." + n.className,
        text: (n.textContent || n.getAttribute("aria-label") || "")
          .trim()
          .slice(0, 70),
        kind,
        foreground: a.slice(0, 3).map(Math.round),
        background: b.slice(0, 3).map(Math.round),
        ratio: ratio(a, b),
        min,
      });
    for (const n of nodes) {
      const s = getComputedStyle(n),
        background = bg(n);
      if (
        [...n.childNodes].some(
          (c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim(),
        ) ||
        n.matches("input:not([type=range]),select")
      ) {
        const large =
          parseFloat(s.fontSize) >= 24 ||
          (parseFloat(s.fontSize) >= 18.6667 && parseInt(s.fontWeight) >= 700);
        add(
          n,
          "text",
          over(rgba(s.color), background),
          background,
          large ? 3 : 4.5,
        );
      }
      if (n.matches("input[placeholder]")) {
        const ps = getComputedStyle(n, "::placeholder");
        const color = rgba(ps.color);
        color[3] *= Number(ps.opacity);
        add(n, "placeholder", over(color, background), background, 4.5);
      }
      if (
        n.matches("button:not(:disabled),input,select,.board-viewport") &&
        n.querySelector("svg")
      )
        add(n, "icon", over(rgba(s.color), background), background, 3);
      if (n.matches("summary"))
        add(
          n,
          "disclosure marker",
          rgba(getComputedStyle(n, "::marker").color),
          background,
          3,
        );
      if (
        n.matches(
          "button:not(:disabled),input:not([type=range]),select,.symbol-choice,summary,.arrange-slot",
        ) &&
        !(
          n.matches("summary") &&
          parseFloat(s.borderTopWidth) === 0 &&
          parseFloat(getComputedStyle(n.parentElement).borderTopWidth) === 0
        )
      ) {
        const border = rgba(
            getComputedStyle(
              n.matches(".arrange-select") ||
                (n.matches("summary") && parseFloat(s.borderTopWidth) === 0)
                ? n.parentElement
                : n,
            ).borderTopColor,
          ),
          outside = bg(
            n.matches(".arrange-select")
              ? n.parentElement.parentElement
              : n.parentElement,
          );
        // A contrasting fill can identify a control without a separate border.
        // Icon-only transparent controls are identified by their tested icon.
        if (!n.matches(".icon-button")) {
          const edge = over(border, outside);
          add(
            n,
            "boundary",
            ratio(background, outside) > ratio(edge, outside)
              ? background
              : edge,
            outside,
            3,
          );
        }
      }
      if (n.matches(":focus-visible") && s.outlineStyle !== "none")
        add(
          n,
          "focus",
          rgba(s.outlineColor),
          parseFloat(s.outlineOffset) < 0 ? background : bg(n.parentElement),
          3,
        );
      if (n.matches(".arrange-select[aria-pressed=true],.arrange-drop-active"))
        add(n, "selection/drop outline", rgba(s.outlineColor), background, 3);
      if (n.matches("input[type=range]") && s.accentColor !== "auto")
        add(n, "range accent", rgba(s.accentColor), background, 3);
    }
    return out;
  });
  records.push(...results.map((r) => ({ ...r, state, theme })));
}
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    await page.goto(url);
    await page.locator(".tile").first().waitFor();
    await audit(page, "board and empty typed speech input", theme);
    const typedInput = page.getByLabel("Type something to say", {
      exact: true,
    });
    await typedInput.fill("Fixture typed contrast phrase");
    await typedInput.focus();
    await audit(page, "typed speech input focus and enabled Speak", theme);
    await page.getByRole("button", { name: "Speak", exact: true }).hover();
    await audit(page, "typed speech Speak hover", theme);
    await typedInput.fill("");
    // All supported saved tones, including small labels and normal-text category hints.
    for (const tone of ["mint", "peach", "blue", "lavender"]) {
      const tile = page.locator(".tile." + tone).first();
      await tile.hover();
      await audit(page, "hover " + tone, theme);
      await page.keyboard.press("Tab");
      await tile.focus();
      await audit(page, "focus " + tone, theme);
      await tile.evaluate((n) => n.classList.add("speaking"));
      await audit(page, "speaking style " + tone, theme);
      await tile.evaluate((n) => n.classList.remove("speaking"));
    }
    await page
      .getByRole("button", { name: "Open Drink category", exact: true })
      .click();
    await audit(page, "category board", theme);
    await page.locator(".board-home").click();
    await page.locator(".board-viewport").focus();
    await audit(page, "board viewport focus", theme);
    await page.screenshot({
      path: `test-results/contrast/${theme}-board.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Caregiver controls", exact: true })
      .click();
    await audit(page, "caregiver entry", theme);
    await page
      .getByRole("button", { name: "Arrange board", exact: true })
      .click();
    await audit(page, "arrangement board", theme);
    await page.locator(".arrange-category-creator summary").click();
    await page.getByLabel("New category name", { exact: true }).focus();
    await audit(page, "arrangement category creator focus", theme);
    for (const tone of ["mint", "peach", "blue", "lavender"]) {
      await page
        .locator(".arrange-slot." + tone + " .arrange-select")
        .first()
        .click();
      await audit(page, "arrangement selected " + tone, theme);
      const slot = page.locator(".arrange-slot." + tone).first();
      await slot.evaluate((n) => n.classList.add("arrange-drop-active"));
      await audit(page, "drop outline style " + tone, theme);
      await slot.evaluate((n) => n.classList.remove("arrange-drop-active"));
    }
    await page
      .getByRole("button", { name: "Open Drink category", exact: true })
      .click();
    await audit(page, "arrangement category and Home controls", theme);
    await page
      .getByRole("button", { name: "Cancel arrangement", exact: true })
      .click();
    await page.locator(".board-home").click();
    await page
      .getByRole("button", { name: "Caregiver controls", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit board and settings", exact: true })
      .click();
    await audit(page, "collapsed settings and edit controls", theme);
    for (const summary of await page
      .locator(".settings-group > summary")
      .all()) {
      await summary.focus();
      await audit(page, "settings disclosure focus", theme);
      await summary.click();
    }
    await audit(page, "expanded settings and edit controls", theme);
    await page.screenshot({
      path: `test-results/contrast/${theme}-settings.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Add word or phrase", exact: true })
      .click();
    await page.locator("dialog[open]").waitFor();
    await audit(page, "add word and phrase", theme);
    await page.getByLabel("Text on the tile", { exact: true }).focus();
    await audit(page, "input focus", theme);
    await page.getByText("Find another symbol", { exact: true }).click();
    await page.getByText("Colour and board position", { exact: true }).click();
    await audit(page, "expanded word editor", theme);
    await page.screenshot({
      path: `test-results/contrast/${theme}-word.png`,
      fullPage: true,
    });
    await page.locator(".symbol-choice").first().click();
    await audit(page, "selected symbol", theme);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await audit(page, "dirty editor dismissal", theme);
    if (
      await page
        .getByRole("button", { name: "Discard changes", exact: true })
        .count()
    )
      await page
        .getByRole("button", { name: "Discard changes", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Add category", exact: true })
      .click();
    await audit(page, "category dialog", theme);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Reset to starter words", exact: true })
      .click();
    await audit(page, "confirmation modal", theme);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Add word or phrase", exact: true })
      .click();
    await audit(page, "phone word dialog", theme);
    await page.screenshot({
      path: `test-results/contrast/${theme}-phone-word.png`,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  "test-results/contrast/ratios.json",
  JSON.stringify({ url, records }, null, 2),
);
const failures = records.filter((r) => r.ratio + 0.00001 < r.min);
console.log(
  JSON.stringify(
    {
      checks: records.length,
      failures: failures.length,
      minimum: Math.min(...records.map((r) => r.ratio)),
      failingPairs: [
        ...new Map(
          failures.map((r) => [
            JSON.stringify([r.theme, r.kind, r.foreground, r.background]),
            r,
          ]),
        ).values(),
      ],
    },
    null,
    2,
  ),
);
assert.equal(
  failures.length,
  0,
  "Contrast failures; see test-results/contrast/ratios.json",
);
