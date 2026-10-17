// Synthetic boards only. No file chooser, downloads, or speech model requests.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5196";
const word = (prefix, index) => ({
  kind: "word",
  id: `${prefix}-${index}`,
  label: `${prefix} ${index}`,
  phrase: `${prefix} ${index}`,
  icon: "check",
  tone: "mint",
});
const fixture = {
  version: 2,
  voice: "",
  rate: 0.85,
  size: "standard",
  tiles: [
    {
      kind: "category",
      id: "everyday",
      subBoardId: "everyday-page",
      label: "Everyday",
      phrase: "Everyday",
      icon: "folder",
      tone: "blue",
    },
    ...Array.from({ length: 54 }, (_, i) => word("Home", i)),
  ],
  subBoards: [
    {
      id: "everyday-page",
      size: "standard",
      tiles: Array.from({ length: 45 }, (_, i) => word("Category", i)),
    },
  ],
};
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];
try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const page = await browser.newPage({
      viewport,
      hasTouch: viewport.width < 500,
    });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((board) => {
      if (!localStorage.getItem("sayboard-v2"))
        localStorage.setItem("sayboard-v2", JSON.stringify(board));
      window.__speechCalls = 0;
      speechSynthesis.speak = () => {
        window.__speechCalls++;
      };
      speechSynthesis.getVoices = () => [];
    }, fixture);
    const saved = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("sayboard-v2")));
    const scroll = async () => {
      await page.evaluate(() =>
        window.scrollTo(
          0,
          Math.min(240, document.documentElement.scrollHeight - innerHeight),
        ),
      );
      const position = await page.evaluate(() => scrollY);
      assert.ok(position > 0, "Fixture must exercise a scrolled board");
      return position;
    };
    const sameScroll = async (position) => {
      try {
        await page.waitForFunction(
          (expected) => Math.abs(scrollY - expected) <= 1,
          position,
        );
      } catch (error) {
        assert.fail(
          `Scroll changed from ${position} to ${await page.evaluate(() => scrollY)}: ${error.message}`,
        );
      }
    };
    const noDialog = async () => {
      await page.locator("dialog").waitFor({ state: "detached" });
    };
    // Locator.click scrolls sticky controls to their original document position.
    // Use the visible button coordinates, as an actual pointer/touch user does.
    const tapAdd = async (control) => {
      const bounds = await control.boundingBox();
      assert.ok(bounds, "Add button must be visible");
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      if (viewport.width < 500) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
    };
    await page.goto(origin);
    const original = await saved();
    const homeAdd = page.getByRole("button", {
      name: "Add tile to Home board",
      exact: true,
    });
    assert.equal(await homeAdd.count(), 1);
    let position = await scroll();
    await tapAdd(homeAdd);
    await page
      .getByRole("heading", { name: "Add a tile", exact: true })
      .waitFor();
    assert.match(
      await page.locator("dialog[open]").innerText(),
      /add a word or phrase to Home board/,
    );
    await page
      .getByRole("button", { name: "Keep communicating", exact: true })
      .click();
    await noDialog();
    await sameScroll(position);
    assert.deepEqual(await saved(), original);

    // Confirm caregiver intent once, then cancel without creating a tile.
    await tapAdd(homeAdd);
    await page
      .getByRole("button", { name: "Continue to add tile", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Add word or phrase", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await noDialog();
    await sameScroll(position);
    assert.deepEqual(await saved(), original);

    // The confirmed session goes directly to the word form.
    await tapAdd(homeAdd);
    assert.equal(
      await page
        .getByRole("heading", { name: "Add a tile", exact: true })
        .count(),
      0,
    );
    await page
      .getByLabel("Text on the tile", { exact: true })
      .fill("Quick home word");
    await page
      .getByRole("button", { name: "Save to board", exact: true })
      .click();
    await noDialog();
    await sameScroll(position);
    let board = await saved();
    assert.equal(
      board.tiles.filter((tile) => tile?.label === "Quick home word").length,
      1,
    );
    assert.equal(board.tiles.at(-1).phrase, "Quick home word");
    assert.deepEqual(board.subBoards, original.subBoards);
    await page.reload();
    await page
      .getByRole("button", { name: "Say Quick home word", exact: true })
      .waitFor();
    assert.deepEqual(await saved(), board);

    // A category has its own accessible destination and retains its scroll.
    await page.locator(".category-tile").click();
    const categoryAdd = page.getByRole("button", {
      name: "Add tile to Everyday",
      exact: true,
    });
    await categoryAdd.waitFor();
    position = await scroll();
    await tapAdd(categoryAdd);
    assert.match(
      await page.locator("dialog[open]").innerText(),
      /add a word or phrase to Everyday/,
    );
    await page
      .getByRole("button", { name: "Continue to add tile", exact: true })
      .click();
    await page
      .getByLabel("Text on the tile", { exact: true })
      .fill("Quick category word");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await noDialog();
    await sameScroll(position);
    assert.deepEqual(await saved(), board);
    await tapAdd(categoryAdd);
    await page
      .getByLabel("Text on the tile", { exact: true })
      .fill("Quick category word");
    await page
      .getByRole("button", { name: "Save to board", exact: true })
      .click();
    await noDialog();
    await sameScroll(position);
    const categoryBoard = await saved();
    assert.deepEqual(categoryBoard.tiles, board.tiles);
    assert.equal(
      categoryBoard.subBoards[0].tiles.at(-1).label,
      "Quick category word",
    );
    await page.reload();
    await page.locator(".category-tile").click();
    await page
      .getByRole("button", { name: "Say Quick category word", exact: true })
      .waitFor();
    assert.deepEqual(await saved(), categoryBoard);

    // Fullscreen hides editing controls until the user leaves.
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
    assert.equal(await categoryAdd.isVisible(), false);
    await page
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Leave fullscreen", exact: true })
      .click();
    await categoryAdd.waitFor({ state: "visible" });
    assert.deepEqual(await saved(), categoryBoard);
    assert.equal(await page.evaluate(() => window.__speechCalls), 0);
    assert.deepEqual(errors, []);
    results.push({ viewport, passed: true });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
