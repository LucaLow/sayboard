// Exercise section navigation against the running app without downloading speech models.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5197";
const browser = await chromium.launch();
try {
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(origin);
    const before = await page.evaluate(() =>
      localStorage.getItem("sayboard-v2"),
    );
    await page
      .getByRole("button", { name: "Caregiver controls", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit board and settings", exact: true })
      .click();
    const navigation = page.getByRole("navigation", {
      name: "Board editor sections",
    });
    for (const label of [/Display/, /Voice/, /Backup/]) {
      const link = navigation.getByRole("link", { name: label });
      await link.focus();
      await page.keyboard.press("Enter");
      const target = page.locator(await link.getAttribute("href"));
      assert.equal(await target.evaluate((node) => node.open), true);
      assert.equal(
        await target
          .locator("summary")
          .evaluate((node) => document.activeElement === node),
        true,
      );
      const targetTop = await target.evaluate(
        (node) => node.getBoundingClientRect().top,
      );
      const headerBottom = await page
        .locator(".editor-header")
        .evaluate((node) => node.getBoundingClientRect().bottom);
      assert.ok(
        targetTop >= headerBottom,
        `Section hidden behind header at ${width}px`,
      );
      assert.ok(
        await page
          .getByRole("button", { name: "Save board", exact: true })
          .isVisible(),
      );
      // A jump must preserve the native summary's keyboard behavior and tab stop.
      assert.equal(
        await target.locator("summary").evaluate((node) => node.tabIndex),
        0,
      );
      await page.keyboard.press("Enter");
      assert.equal(await target.evaluate((node) => node.open), false);
    }
    await navigation.getByRole("link", { name: /Words/ }).click();
    assert.equal(
      await page
        .getByRole("heading", { name: "Words and categories", exact: true })
        .evaluate((node) => document.activeElement === node),
      true,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("sayboard-v2")),
      before,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `test-results/editor-navigation-${width}.png`,
    });
    await page.close();
  }
  console.log("Editor section navigation passed at 320, 390, 768 and 1280px");
} finally {
  await browser.close();
}
