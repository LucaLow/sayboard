// Synthetic vocabulary only. No account access or voice model download.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5189/";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const results = [];
await mkdir("test-results/symbol-picker", { recursive: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.context().setOffline(true);
    const category = page.getByRole("button", {
      name: "Open Drink category",
      exact: true,
    });
    await category.click();
    assert.equal(
      await page
        .getByRole("button", { name: "Say Water", exact: true })
        .isVisible(),
      true,
    );
    await page
      .getByRole("button", { name: "Back / Home", exact: true })
      .click();
    assert.equal(
      await category.evaluate((node) => node === document.activeElement),
      true,
      "Offline category navigation restores focus",
    );
    await page
      .getByRole("button", { name: "Caregiver controls", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit board and settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add word or phrase", exact: true })
      .click();
    const dialog = page.locator("dialog[open]");
    const label = dialog.getByLabel("Text on the tile", { exact: true });
    await label.fill("water");
    const selection = dialog.locator(".symbol-selection");
    assert.equal(await selection.textContent(), "glass water");
    assert.equal(await selection.locator("svg[aria-hidden=true]").count(), 1);
    await dialog.getByText("Find another symbol", { exact: true }).click();
    const search = dialog.getByLabel("Search symbols", { exact: true });
    const kind = dialog.locator(".symbol-filters select");
    const found = dialog.getByRole("group", {
      name: "Symbol search results",
      exact: true,
    });
    await search.fill("water");
    await search.press("Enter");
    assert.equal(
      await dialog.isVisible(),
      true,
      "Enter in symbol search keeps the tile form open",
    );
    await kind.selectOption("icon");
    const first = found.getByRole("button").first();
    assert.equal(await first.getAttribute("data-symbol-id"), "glass-water");
    await search.fill("circle");
    await first.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await found
        .getByRole("button")
        .nth(1)
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press("End");
    assert.equal(
      await found
        .getByRole("button")
        .last()
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press("Home");
    assert.equal(
      await first.evaluate((node) => node === document.activeElement),
      true,
    );
    assert.equal(await found.locator("button[tabindex='0']").count(), 1);
    await search.fill("red apple");
    await kind.selectOption("emoji");
    const apple = found.getByRole("button", {
      name: "Choose red apple emoji",
      exact: true,
    });
    assert.equal(
      await apple.locator(".emoji[aria-hidden=true]").textContent(),
      "🍎",
    );
    await apple.click();
    assert.equal(await apple.getAttribute("aria-pressed"), "true");
    await label.fill("help");
    assert.equal(
      await selection.textContent(),
      "🍎red apple",
      "Explicit symbol survives changed text",
    );
    await dialog
      .getByRole("button", { name: "Use text suggestions", exact: true })
      .click();
    assert.equal(await selection.textContent(), "circle help");
    await apple.click();
    await search.fill("totallyunknownword");
    assert.equal(await found.getByRole("button").count(), 0);
    assert.match(
      await dialog.locator(".symbol-count").textContent(),
      /No matching symbols/,
    );
    assert.equal(
      await selection.textContent(),
      "🍎red apple",
      "Searching does not change explicit selection",
    );
    await dialog.screenshot({
      path: `test-results/symbol-picker/picker-${width}.png`,
    });
    await dialog
      .getByRole("button", { name: "Add to board draft", exact: true })
      .click();
    await page.getByRole("button", { name: "Save board", exact: true }).click();
    await page.context().setOffline(false);
    await page.reload();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("sayboard-v2")),
    );
    const tile = saved.tiles.find((tile) => tile?.label === "help");
    assert.equal(tile.icon, "emoji:1f34e");
    assert.equal(
      await page
        .getByRole("button", { name: "Say help", exact: true })
        .locator(".emoji")
        .textContent(),
      "🍎",
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      savedIcon: tile.icon,
      offlineNavigationAndEditing: true,
      pageErrors: errors,
    });
    await page.close();
  }
  await writeFile(
    "test-results/symbol-picker/results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    "Symbol search, keyboard focus, explicit/automatic selection and persistence passed at 390 and 1280 px.",
  );
} finally {
  await browser.close();
}
