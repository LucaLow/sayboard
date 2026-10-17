// Synthetic board only. No account, download/file chooser or TLS bypass.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5194";
const results = [];
try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    for (const [fullscreen, fontFamily] of [
      [false, null],
      [true, null],
      [false, "DejaVu Sans"],
      [true, "DejaVu Sans"],
    ]) {
      for (const label of [
        "Drink",
        "A very long category name !!!!!!!!!!!!!!",
      ]) {
        const page = await browser.newPage({ viewport });
        const word = (id, label) => ({
          kind: "word",
          id,
          label,
          phrase: label,
          icon: "emoji:1f4a7",
          tone: "blue",
        });
        const board = {
          version: 2,
          tiles: [
            {
              ...word("drink", label),
              kind: "category",
              subBoardId: "drinks",
            },
            word("yes", "Yes"),
          ],
          voice: "",
          rate: 1,
          size: "small",
          subBoards: [
            {
              id: "drinks",
              size: "small",
              tiles: Array.from({ length: 20 }, (_, index) =>
                word(`water-${index}`, `Water ${index}`),
              ),
            },
          ],
        };
        await page.addInitScript((value) => {
          localStorage.setItem("sayboard-v2", JSON.stringify(value));
          Object.defineProperty(document, "fullscreenEnabled", {
            value: false,
          });
        }, board);
        await page.goto(origin);
        // Wider system font metrics must not wrap Back / Home and shift tiles.
        if (fontFamily)
          await page.addStyleTag({
            content: ':root { font-family: "DejaVu Sans", sans-serif; }',
          });
        if (fullscreen)
          await page
            .getByRole("button", {
              name: "Enter fullscreen communication board",
            })
            .click();
        assert.equal(
          await page.locator(".board-navigation").count(),
          0,
          "Root has no redundant navigation row",
        );
        const geometry = () =>
          page.locator(".grid").evaluate((n) => ({
            top: n.getBoundingClientRect().top,
            overflow: document.documentElement.scrollWidth > innerWidth,
          }));
        const root = await geometry();
        await page
          .getByRole("button", {
            name: `Open ${label} category`,
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Back / Home", exact: true })
          .waitFor();
        const category = await geometry();
        assert.ok(
          Math.abs(root.top - category.top) < 1,
          `Grid moved entering ${label}: ${root.top} -> ${category.top}`,
        );
        assert.equal(
          category.overflow,
          false,
          "Long category keeps horizontal bounds",
        );
        assert.equal(
          await page.locator(".header > .board-navigation").count(),
          1,
          "Category navigation occupies header slot",
        );
        if (fullscreen)
          assert.ok(
            await page
              .getByRole("button", { name: "Exit fullscreen", exact: true })
              .isVisible(),
          );
        else
          assert.ok(
            await page
              .getByRole("button", {
                name: "Caregiver controls",
                exact: true,
              })
              .isVisible(),
          );
        if (!fullscreen) {
          await page.evaluate(() => window.scrollTo(0, 400));
          const back = await page
            .getByRole("button", { name: "Back / Home", exact: true })
            .boundingBox();
          assert.ok(
            back && back.y >= 0 && back.y + back.height <= viewport.height,
            "Back remains reachable while the category scrolls",
          );
        }
        await page
          .getByRole("button", { name: "Back / Home", exact: true })
          .click();
        const returned = await geometry();
        assert.ok(
          Math.abs(root.top - returned.top) < 1,
          "Grid moved returning home",
        );
        assert.ok(
          await page
            .getByRole("button", {
              name: `Open ${label} category`,
              exact: true,
            })
            .evaluate((n) => n === document.activeElement),
          "Back restores category focus",
        );
        results.push({
          viewport,
          fullscreen,
          label,
          fontFamily,
          gridTop: root.top,
        });
        await page.close();
      }
    }
  }
  console.log(JSON.stringify({ scenarios: results.length, results }, null, 2));
} finally {
  await browser.close();
}
