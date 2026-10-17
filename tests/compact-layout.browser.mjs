// Run against a production build or public deployment using synthetic words only.
// No login, file chooser, export/download, TLS bypass or real account data.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.SAYBOARD_PLAYWRIGHT_PATH || "playwright",
);
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5191";
const results = [];
await mkdir("test-results/compact", { recursive: true });
async function caregiver(page) {
  await page
    .getByRole("button", { name: "Caregiver controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit board and settings", exact: true })
    .click();
  await page.getByText("Display and tile size", { exact: true }).click();
}
async function savedBoard(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("sayboard-v2")));
}
async function geometry(page) {
  return page.evaluate(() => {
    const grid = document.querySelector(".grid");
    const tiles = [...grid.querySelectorAll(".tile")];
    return {
      size: grid.dataset.size,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      gap: getComputedStyle(grid).gap,
      count: tiles.length,
      visible: tiles.filter((tile) => {
        const rect = tile.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.bottom <= innerHeight &&
          rect.left >= 0 &&
          rect.right <= innerWidth
        );
      }).length,
      minimumTile: Math.min(
        ...tiles.map((tile) =>
          Math.min(
            tile.getBoundingClientRect().width,
            tile.getBoundingClientRect().height,
          ),
        ),
      ),
      minimumControl: Math.min(
        ...[...document.querySelectorAll("button")]
          .filter(
            (button) =>
              button.getBoundingClientRect().width > 0 &&
              button.getBoundingClientRect().height > 0,
          )
          .map((button) =>
            Math.min(
              button.getBoundingClientRect().width,
              button.getBoundingClientRect().height,
            ),
          ),
      ),
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      firstSixBottom: tiles[5]?.getBoundingClientRect().bottom,
    };
  });
}
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector(".tile");
    const originalWords = await page.locator(".tile").allTextContents();
    await caregiver(page);
    await page.getByRole("button", { name: "Save board", exact: true }).click();
    const baseline = await savedBoard(page);
    await caregiver(page);
    await page
      .getByRole("button", { name: "Compact phone preset", exact: true })
      .click();
    assert.deepEqual(await savedBoard(page), baseline);
    assert.equal(
      await page.locator(".device-layout-settings select").first().inputValue(),
      "small",
    );
    assert.equal(
      await page.locator(".device-layout-settings select").last().inputValue(),
      "2",
    );
    assert.equal(await page.locator(".layout-preview span").count(), 10);
    await page
      .getByRole("button", { name: "Back to board", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.waitForSelector(".grid");
    assert.equal((await geometry(page)).size, "standard");
    await caregiver(page);
    await page
      .getByRole("button", { name: "Compact phone preset", exact: true })
      .click();
    await page.getByRole("button", { name: "Save board", exact: true }).click();
    assert.deepEqual(await savedBoard(page), baseline);
    await page.reload();
    await page.waitForSelector('.grid[data-size="small"]');
    const measured = await geometry(page);
    assert.equal(measured.columns, 2);
    assert.equal(measured.gap, "12px");
    assert.equal(measured.count, 20);
    assert.ok(measured.minimumTile >= 96);
    assert.ok(measured.minimumControl >= 44);
    assert.equal(measured.documentOverflow, false);
    if (viewport.height >= 568)
      assert.ok(measured.visible >= 6, JSON.stringify(measured));
    assert.deepEqual(
      await page.locator(".tile").allTextContents(),
      originalWords,
    );
    await page.screenshot({
      path: `test-results/compact/${viewport.width}x${viewport.height}.png`,
    });
    const firstPosition = await page.locator(".tile").first().boundingBox();
    await page.evaluate(() => {
      document.querySelector("#status").textContent =
        "Synthetic speech error ".repeat(20);
    });
    assert.deepEqual(
      await page.locator(".tile").first().boundingBox(),
      firstPosition,
    );
    assert.equal(await page.locator(".speechbar, .speech-actions").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator("#status")
        .evaluate((node) => getComputedStyle(node).position),
      "absolute",
    );
    await page
      .getByRole("button", { name: "Open Drink category", exact: true })
      .click();
    assert.equal(await page.locator(".tile").count(), 3);
    assert.equal(
      await page.locator(".grid").getAttribute("data-size"),
      "small",
    );
    await page
      .getByRole("button", { name: "Back / Home", exact: true })
      .click();
    assert.equal(await page.locator(".tile").count(), 20);
    await page
      .getByRole("button", {
        name: "Enter fullscreen communication board",
        exact: true,
      })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#app")
        .classList.contains("communication-fullscreen"),
    );
    assert.equal((await geometry(page)).size, "small");
    assert.equal((await geometry(page)).columns, 2);
    assert.ok((await geometry(page)).minimumTile >= 96);
    assert.ok(
      await page
        .getByRole("button", { name: "Exit fullscreen", exact: true })
        .evaluate(
          (button) =>
            Math.min(
              button.getBoundingClientRect().width,
              button.getBoundingClientRect().height,
            ) >= 44,
        ),
    );
    await page
      .getByRole("button", { name: "Open Drink category", exact: true })
      .click();
    assert.equal(
      await page.locator(".grid").getAttribute("data-size"),
      "small",
    );
    await page
      .getByRole("button", { name: "Back / Home", exact: true })
      .click();
    await page.screenshot({
      path: `test-results/compact/fullscreen-${viewport.width}x${viewport.height}.png`,
    });
    await page
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Leave fullscreen", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#app")
          .classList.contains("communication-fullscreen"),
    );
    assert.deepEqual(await savedBoard(page), baseline);
    assert.equal((await geometry(page)).size, "small");
    await page.locator(".tile").last().scrollIntoViewIfNeeded();
    assert.ok(await page.locator(".tile").last().isVisible());
    await page.setViewportSize({
      width: viewport.height,
      height: viewport.width,
    });
    assert.equal((await geometry(page)).columns, 2);
    assert.deepEqual(await savedBoard(page), baseline);
    // Exercise a real saved maximum-length label, emoji and 60 stable slots.
    await page.evaluate((fixture) => {
      fixture.tiles[0].label = "A".repeat(40);
      fixture.tiles[0].icon = "emoji:1f34e";
      while (fixture.tiles.length < 60) fixture.tiles.push(null);
      fixture.tiles[42] = fixture.tiles[0];
      fixture.tiles[0] = null;
      localStorage.setItem("sayboard-v2", JSON.stringify(fixture));
    }, baseline);
    await page.reload();
    await page.waitForSelector('.grid[data-size="small"]');
    assert.equal(await page.locator(".grid > *").count(), 60);
    const label = page
      .getByRole("button", { name: `Say ${"A".repeat(40)}`, exact: true })
      .locator("span")
      .last();
    await label.scrollIntoViewIfNeeded();
    assert.ok(
      await label.evaluate(
        (node) =>
          node.scrollWidth <= node.clientWidth + 1 &&
          node.scrollHeight <= node.clientHeight + 1,
      ),
    );
    assert.equal(await label.textContent(), "A".repeat(40));
    assert.equal(
      await page.locator(".grid > *").first().getAttribute("class"),
      "empty-slot",
    );
    assert.equal(
      await page.locator(".grid > *").last().getAttribute("class"),
      "empty-slot",
    );
    assert.deepEqual(errors, []);
    results.push({ viewport, ...measured });
    await page.close();
  }
  const failurePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await failurePage.goto(origin);
  await caregiver(failurePage);
  await failurePage
    .getByRole("button", { name: "Save board", exact: true })
    .click();
  const baseline = await savedBoard(failurePage);
  await caregiver(failurePage);
  await failurePage
    .getByRole("button", { name: "Compact phone preset", exact: true })
    .click();
  await failurePage.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "sayboard-v2")
        throw new Error("Synthetic blocked board storage");
      return original.call(this, key, value);
    };
  });
  await failurePage
    .getByRole("button", { name: "Save board", exact: true })
    .click();
  assert.equal(await failurePage.locator(".device-layout-settings").count(), 1);
  assert.deepEqual(await savedBoard(failurePage), baseline);
  await failurePage
    .getByRole("button", { name: "Back to board", exact: true })
    .click();
  await failurePage
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await failurePage.waitForSelector(".grid");
  assert.equal((await geometry(failurePage)).size, "standard");
  await failurePage.reload();
  await caregiver(failurePage);
  await failurePage
    .getByRole("button", { name: "Compact phone preset", exact: true })
    .click();
  await failurePage.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "sayboard-device-layout-v1")
        throw new Error("Synthetic blocked display storage");
      return original.call(this, key, value);
    };
  });
  await failurePage
    .getByRole("button", { name: "Save board", exact: true })
    .click();
  await failurePage.waitForSelector('.grid[data-size="small"]');
  assert.match(
    await failurePage.locator("#status").textContent(),
    /session only/,
  );
  assert.deepEqual(await savedBoard(failurePage), baseline);
  await failurePage.reload();
  await failurePage.waitForSelector(".grid");
  assert.equal((await geometry(failurePage)).size, "standard");
  await failurePage.close();
  await writeFile(
    "test-results/compact/results.json",
    JSON.stringify({ origin, results }, null, 2),
  );
  console.log(JSON.stringify({ origin, results }, null, 2));
} finally {
  await browser.close();
}
