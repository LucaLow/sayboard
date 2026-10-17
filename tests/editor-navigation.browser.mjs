// Synthetic vocabulary only. No account, download, file chooser or model download.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5196";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const word = (id, label) => ({
  kind: "word",
  id,
  label,
  phrase: label,
  icon: "heart",
  tone: "mint",
});
const fixture = {
  version: 2,
  size: "standard",
  rate: 1,
  voice: "",
  tiles: [
    { ...word("drinks", "Drinks"), kind: "category", subBoardId: "drinks" },
    ...Array.from({ length: 39 }, (_, i) => word(`word-${i}`, `Word ${i}`)),
  ],
  subBoards: [
    { id: "drinks", size: "standard", tiles: [word("water", "Water"), null] },
  ],
};
await mkdir("test-results/editor-navigation", { recursive: true });
const results = [];
try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const page = await browser.newPage({
      viewport,
      hasTouch: viewport.width < 500,
    });
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      speechSynthesis.getVoices = () => [];
    });
    await page.goto(origin);
    await page.evaluate((value) => {
      localStorage.clear();
      localStorage.setItem("sayboard-v2", JSON.stringify(value));
    }, fixture);
    await page.reload();
    const stored = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("sayboard-v2")));
    const openCaregiver = () =>
      page
        .getByRole("button", { name: "Caregiver controls", exact: true })
        .click();
    const openEditor = async () => {
      await openCaregiver();
      await page
        .getByRole("button", { name: "Edit board and settings", exact: true })
        .click();
    };
    const state = page.locator(".editor-save-state");
    const save = page.getByRole("button", { name: "Save board", exact: true });
    await page.evaluate(() => scrollTo(0, 600));
    assert.equal(
      await page
        .locator(".header")
        .evaluate((n) => n.getBoundingClientRect().top),
      0,
      "No uncovered strip above sticky header",
    );
    await openCaregiver();
    const entryGeometry = await page
      .locator("dialog[open]")
      .evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return [...dialog.querySelectorAll("button")].every((button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.left >= bounds.left &&
            rect.right <= bounds.right &&
            button.scrollWidth <= button.clientWidth
          );
        });
      });
    assert.ok(entryGeometry, "All caregiver actions fit, with unclipped text");
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => scrollY),
      scrollBefore,
      "Modal locks background scrolling",
    );
    await page.screenshot({
      path: `test-results/editor-navigation/caregiver-${viewport.width}.png`,
    });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    await page.waitForFunction(
      () => !document.documentElement.classList.contains("modal-open"),
    );
    await openEditor();
    assert.equal(await state.textContent(), "No unsaved changes");
    assert.equal(
      await page.locator(".editor-location").textContent(),
      "Home board",
    );
    await page.getByText("Display and tile size", { exact: true }).click();
    await page
      .getByLabel("Default tile size for this board", { exact: true })
      .selectOption("large");
    assert.equal(await state.textContent(), "Unsaved changes on this device");
    await page
      .getByLabel("Default tile size for this board", { exact: true })
      .selectOption("standard");
    assert.equal(
      await state.textContent(),
      "No unsaved changes",
      "Reverted changes restore clean state",
    );
    await page
      .getByRole("button", { name: "Compact phone preset", exact: true })
      .click();
    assert.equal(await state.textContent(), "Unsaved changes on this device");
    await page.getByText("Voice and speaking speed", { exact: true }).click();
    await page.getByLabel("Speaking speed", { exact: true }).fill("1.1");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Settings contain horizontal overflow",
    );
    await page.locator(".edit-row").last().scrollIntoViewIfNeeded();
    const bar = await page.locator(".editor-header").boundingBox();
    const saveBounds = await save.boundingBox();
    assert.equal(bar.y, 0);
    assert.ok(
      saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= viewport.height,
      "Save stays reachable while scrolling",
    );
    await page.screenshot({
      path: `test-results/editor-navigation/editor-${viewport.width}.png`,
    });
    await page
      .getByRole("button", { name: "Back to board", exact: true })
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await state.textContent(), "Unsaved changes on this device");
    assert.deepEqual(
      await stored(),
      fixture,
      "Cancel back leaves saved vocabulary untouched",
    );
    await page
      .getByRole("button", { name: "Open Drinks category", exact: true })
      .click();
    assert.equal(
      await page.locator(".editor-context .board-name").textContent(),
      "Drinks",
    );
    await page.getByRole("button", { name: "Edit Water", exact: true }).click();
    await page
      .getByLabel("Text on the tile", { exact: true })
      .fill("Fresh water");
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    assert.equal(await state.textContent(), "Unsaved changes on this device");
    assert.equal((await stored()).subBoards[0].tiles[0].label, "Water");
    await page
      .getByRole("button", { name: "Back / Home", exact: true })
      .click();
    assert.equal(
      await page.locator(".editor-location").textContent(),
      "Home board",
    );
    assert.equal(
      await page
        .locator(".settings-group")
        .filter({ hasText: "Display and tile size" })
        .getAttribute("open"),
      "",
      "Expanded settings survive word changes and navigation",
    );
    await save.click();
    await page
      .getByRole("button", { name: "Caregiver controls", exact: true })
      .waitFor();
    const saved = await stored();
    assert.equal(saved.subBoards[0].tiles[0].label, "Fresh water");
    assert.equal(saved.rate, 1.1);
    assert.deepEqual(saved.tiles, fixture.tiles);
    await page.reload();
    assert.deepEqual(await stored(), saved);
    await openEditor();
    assert.equal(await state.textContent(), "No unsaved changes");
    await page
      .getByRole("button", { name: "Edit Word 0", exact: true })
      .click();
    await page
      .getByLabel("Text on the tile", { exact: true })
      .fill("Discard me");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Text on the tile", { exact: true }).inputValue(),
      "Discard me",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    assert.equal(await state.textContent(), "No unsaved changes");
    await page
      .getByRole("button", { name: "Edit Word 0", exact: true })
      .click();
    await page
      .getByLabel("Text on the tile", { exact: true })
      .fill("Unsaved word");
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Back to board", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page
      .getByRole("button", { name: "Say Word 0", exact: true })
      .waitFor();
    assert.deepEqual(
      await stored(),
      saved,
      "Confirmed discard restores saved board",
    );
    await openEditor();
    await page
      .getByRole("button", { name: "Back to board", exact: true })
      .click();
    assert.equal(
      await page.locator("dialog[open]").count(),
      0,
      "Clean exit needs no confirmation",
    );
    assert.deepEqual(errors, []);
    results.push({ viewport, passed: true });
    await page.close();
  }
  await writeFile(
    "test-results/editor-navigation/results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
