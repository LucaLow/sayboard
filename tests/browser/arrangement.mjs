// Demonstration fixtures only. No account, download, chooser or certificate bypass.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5196";
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
mkdirSync("test-results/arrangement", { recursive: true });
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
  size: "small",
  rate: 0.85,
  voice: "",
  tiles: [
    word("yes", "Yes"),
    word("no", "No"),
    null,
    {
      ...word("drinks", "Drinks"),
      kind: "category",
      subBoardId: "drinks-page",
    },
    word("help", "Help"),
  ],
  subBoards: [
    { id: "drinks-page", size: "large", tiles: [word("water", "Water"), null] },
  ],
};
const results = [];
async function openArrange(page) {
  await page
    .getByRole("button", { name: "Caregiver controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Arrange board", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Arrange board", exact: true })
    .waitFor();
}
async function drag(page, from, to) {
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}
try {
  for (const viewport of [
    { width: 1280, height: 1400 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const context = await browser.newContext({
      viewport,
      hasTouch: viewport.width < 500,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate((board) => {
      localStorage.clear();
      localStorage.setItem("sayboard-v2", JSON.stringify(board));
      localStorage.setItem(
        "sayboard-device-layout-v1",
        JSON.stringify({ columns: 2, size: null }),
      );
    }, fixture);
    await page.reload();
    const stored = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("sayboard-v2")));
    assert.equal(await page.locator(".arrange-handle").count(), 0);
    await openArrange(page);
    // Keyboard alternative: select, choose a stable slot, apply.
    await page
      .getByRole("button", { name: "Select Yes, slot 1", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Destination slot", { exact: true })
      .selectOption("1");
    await page
      .getByRole("button", { name: "Move / swap slot", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Select Yes, slot 2", exact: true })
      .waitFor();
    assert.deepEqual(
      (await stored()).tiles,
      fixture.tiles,
      "unsaved draft must not persist",
    );
    await page.locator(".arrange-category-creator summary").click();
    await page.getByLabel("New category name", { exact: true }).fill("Snacks");
    await page
      .getByRole("button", { name: "Create category", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Snacks category", exact: true })
      .waitFor();
    // Desktop pointer dragging uses explicit handles and category drop zones.
    if (viewport.width > 500) {
      await drag(
        page,
        page.getByRole("button", {
          name: "Drag No. Or activate to use move controls",
          exact: true,
        }),
        page.getByRole("button", { name: "Select Help, slot 5", exact: true }),
      );
      await page
        .getByRole("button", { name: "Select No, slot 5", exact: true })
        .waitFor();
      const cancelHandle = await page
        .getByRole("button", {
          name: "Drag Yes. Or activate to use move controls",
          exact: true,
        })
        .boundingBox();
      assert.ok(cancelHandle);
      await page.mouse.move(cancelHandle.x + 20, cancelHandle.y + 20);
      await page.mouse.down();
      await page.mouse.move(cancelHandle.x + 35, cancelHandle.y + 35);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal(await page.locator(".arrange-dragging").count(), 0);
      await page
        .getByRole("button", { name: "Select Yes, slot 2", exact: true })
        .waitFor();
      await drag(
        page,
        page.getByRole("button", {
          name: "Drag Yes. Or activate to use move controls",
          exact: true,
        }),
        page.getByRole("button", { name: "Move into Snacks", exact: true }),
      );
      await page
        .getByRole("button", { name: "Empty slot 2", exact: true })
        .waitFor();
    } else {
      await page
        .getByRole("button", { name: "Select Yes, slot 2", exact: true })
        .tap();
      await page
        .getByLabel("Destination board", { exact: true })
        .selectOption({ label: "Snacks" });
      await page
        .getByRole("button", { name: "Move to board", exact: true })
        .tap();
      assert.equal(
        await page
          .locator(".arrange-handle")
          .first()
          .evaluate((n) => getComputedStyle(n).touchAction),
        "none",
      );
      assert.notEqual(
        await page
          .locator(".arrange-select")
          .first()
          .evaluate((n) => getComputedStyle(n).touchAction),
        "none",
        "tile body must allow scrolling",
      );
    }
    await page
      .getByRole("button", { name: "Open Snacks category", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Select Yes, slot 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move selected word to Home", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Back / Home", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Select Yes, slot 2", exact: true })
      .waitFor();
    // Category cannot be nested through accessible controls.
    await page
      .getByRole("button", { name: "Select Snacks, slot 3", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Move to board", exact: true })
        .isDisabled(),
      true,
    );
    // Escape cancels selection without discarding completed draft edits.
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator('.arrange-select[aria-pressed="true"]').count(),
      0,
    );
    await page
      .getByRole("button", { name: "Switch to dark mode", exact: true })
      .click();
    await page.screenshot({
      path: `test-results/arrangement/${viewport.width}-dark.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Switch to light mode", exact: true })
      .click();
    await page.screenshot({
      path: `test-results/arrangement/${viewport.width}-light.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "page stays within viewport",
    );
    await page
      .getByRole("button", { name: "Save arrangement", exact: true })
      .click();
    const saved = await stored();
    assert.equal(saved.tiles[1].id, "yes");
    assert.equal(saved.tiles[2].kind, "category");
    assert.equal(saved.tiles[2].label, "Snacks");
    assert.equal(saved.subBoards[0].size, "large");
    assert.equal(saved.subBoards.at(-1).tiles[0], null);
    await page.reload();
    await page
      .getByRole("button", { name: "Open Snacks category", exact: true })
      .waitFor();
    assert.deepEqual(await stored(), saved);
    await openArrange(page);
    await page.locator(".arrange-category-creator summary").click();
    await page
      .getByLabel("New category name", { exact: true })
      .fill("Cancelled fixture");
    await page
      .getByRole("button", { name: "Create category", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        dispatchEvent(event);
        return event.defaultPrevented;
      }),
      true,
      "unsaved arrangement warns before leaving the page",
    );
    await page
      .getByRole("button", { name: "Cancel arrangement", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("dialog", { name: "Confirm board change", exact: true })
        .count(),
      1,
      "unsaved arrangement asks before discarding",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Open Cancelled fixture category",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Cancel arrangement", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Say Yes", exact: true }).waitFor();
    assert.deepEqual(await stored(), saved);
    assert.equal(
      await page
        .getByRole("button", {
          name: "Open Cancelled fixture category",
          exact: true,
        })
        .count(),
      0,
    );
    await openArrange(page);
    await page
      .getByRole("button", { name: "Cancel arrangement", exact: true })
      .click();
    assert.equal(
      await page.locator("dialog[open]").count(),
      0,
      "clean arrangement cancels without confirmation",
    );
    assert.deepEqual(errors, []);
    results.push({ viewport: viewport.width, outcome: "pass" });
    await context.close();
  }
  // Real touch pointer events: tile bodies scroll, handles alone drag.
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(origin);
  const touchFixture = {
    ...fixture,
    tiles: [
      fixture.tiles[0],
      fixture.tiles[3],
      ...Array.from({ length: 12 }, (_, index) =>
        word(`touch-${index}`, `Fixture ${index}`),
      ),
    ],
  };
  await touchPage.evaluate((board) => {
    localStorage.clear();
    localStorage.setItem("sayboard-v2", JSON.stringify(board));
    localStorage.setItem(
      "sayboard-device-layout-v1",
      JSON.stringify({ columns: 2, size: "small" }),
    );
  }, touchFixture);
  await touchPage.reload();
  await openArrange(touchPage);
  const cdp = await touchContext.newCDPSession(touchPage);
  const body = await touchPage
    .getByRole("button", { name: "Select Yes, slot 1", exact: true })
    .boundingBox();
  assert.ok(body);
  const touch = async (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  await touch("touchStart", body.x + body.width / 2, body.y + 80);
  for (let offset = 20; offset <= 160; offset += 20) {
    await touch("touchMove", body.x + body.width / 2, body.y + 80 - offset);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await touch("touchEnd", 0, 0);
  assert.ok(
    await touchPage.evaluate(() => scrollY > 0),
    "touching tile body scrolls",
  );
  // Let the body swipe's native momentum finish before measuring drag targets.
  // Otherwise a correct touch can land on a moved slot rather than its category button.
  await touchPage.evaluate(
    () =>
      new Promise((resolve, reject) => {
        let last = scrollY;
        let stable = 0;
        let frames = 0;
        function sample() {
          stable = scrollY === last ? stable + 1 : 0;
          last = scrollY;
          if (stable >= 4) {
            resolve();
            return;
          }
          if (++frames > 300) {
            reject(new Error("Touch scroll did not settle"));
            return;
          }
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      }),
  );
  await touchPage.evaluate(() => scrollTo(0, 0));
  await touchPage.waitForFunction(() => scrollY === 0);
  const touchHandle = await touchPage
    .getByRole("button", {
      name: "Drag Yes. Or activate to use move controls",
      exact: true,
    })
    .boundingBox();
  const touchDrop = await touchPage
    .getByRole("button", { name: "Move into Drinks", exact: true })
    .boundingBox();
  assert.ok(
    touchHandle && touchDrop && touchHandle.y < 844 && touchDrop.y < 844,
  );
  const start = {
    x: touchHandle.x + touchHandle.width / 2,
    y: touchHandle.y + touchHandle.height / 2,
  };
  const end = {
    x: touchDrop.x + touchDrop.width / 2,
    y: touchDrop.y + touchDrop.height / 2,
  };
  await touch("touchStart", start.x, start.y);
  for (let step = 1; step <= 8; step++) {
    await touch(
      "touchMove",
      start.x + ((end.x - start.x) * step) / 8,
      start.y + ((end.y - start.y) * step) / 8,
    );
  }
  assert.equal(
    await touchPage.locator(".arrange-drop-active").count(),
    1,
    "touch drag highlights a destination",
  );
  await touchPage
    .locator(".arrange-category-drop.arrange-drop-active")
    .waitFor();
  await touch("touchEnd", 0, 0);
  await touchPage
    .getByRole("button", { name: "Empty slot 1", exact: true })
    .waitFor();
  await touchPage
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  const touchSaved = await touchPage.evaluate(() =>
    JSON.parse(localStorage.getItem("sayboard-v2")),
  );
  assert.equal(touchSaved.subBoards[0].tiles[1].id, "yes");
  assert.equal(touchSaved.tiles[0], null);
  results.push({
    touchHandleDrag: "pass",
    tileBodyScroll: "pass",
    dropFeedback: "pass",
  });
  await touchContext.close();

  // Failed saves retain the working draft and the previous persisted board.
  const failurePage = await browser.newPage();
  await failurePage.goto(origin);
  await failurePage.evaluate((board) => {
    localStorage.clear();
    localStorage.setItem("sayboard-v2", JSON.stringify(board));
  }, fixture);
  await failurePage.reload();
  await openArrange(failurePage);
  await failurePage.locator(".arrange-category-creator summary").click();
  await failurePage
    .getByLabel("New category name", { exact: true })
    .fill("Unsaved fixture");
  await failurePage
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await failurePage.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "sayboard-v2")
        throw new DOMException("Fixture quota", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await failurePage
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  await failurePage
    .getByRole("heading", { name: "Arrange board", exact: true })
    .waitFor();
  assert.match(
    await failurePage.locator(".arrange-feedback").textContent(),
    /Could not save/,
  );
  assert.equal(
    await failurePage
      .getByRole("button", {
        name: "Open Unsaved fixture category",
        exact: true,
      })
      .count(),
    1,
  );
  assert.deepEqual(
    await failurePage.evaluate(() =>
      JSON.parse(localStorage.getItem("sayboard-v2")),
    ),
    fixture,
  );
  await failurePage
    .getByRole("button", { name: "Cancel arrangement", exact: true })
    .click();
  await failurePage
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await failurePage
    .getByRole("button", { name: "Say Yes", exact: true })
    .waitFor();
  await failurePage.reload();
  await failurePage.evaluate(() => {
    localStorage.setItem("sayboard-v2", "fixture invalid JSON");
  });
  await failurePage.reload();
  await openArrange(failurePage);
  await failurePage
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  assert.match(
    await failurePage.locator(".arrange-feedback").textContent(),
    /saved board is retained/,
  );
  assert.equal(
    await failurePage.evaluate(() => localStorage.getItem("sayboard-v2")),
    "fixture invalid JSON",
  );
  results.push({
    failedSaveDraftRetention: "pass",
    corruptStoredBytes: "retained",
  });
  await failurePage.close();

  // Starting a handle drag must bring Escape inside the arrangement even if
  // a header control held focus before the pointer gesture.
  for (const fullscreen of [false, true]) {
    const escapePage = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
      colorScheme: "light",
    });
    await escapePage.addInitScript((board) => {
      localStorage.setItem("sayboard-v2", JSON.stringify(board));
      Object.defineProperty(document, "fullscreenEnabled", { value: false });
    }, fixture);
    await escapePage.goto(origin);
    await openArrange(escapePage);
    if (fullscreen) {
      await escapePage
        .getByRole("button", {
          name: "Enter fullscreen communication board",
          exact: true,
        })
        .click();
      await escapePage
        .getByRole("button", { name: "Exit fullscreen", exact: true })
        .focus();
    } else {
      await escapePage
        .getByRole("button", { name: "Switch to dark mode", exact: true })
        .click();
    }
    assert.ok(
      await escapePage.evaluate(() =>
        Boolean(document.activeElement.closest(".header")),
      ),
      "header owns focus before drag",
    );
    const handle = escapePage.getByRole("button", {
      name: "Drag Yes. Or activate to use move controls",
      exact: true,
    });
    const target = escapePage.locator('[data-drop-slot="1"]');
    const start = await handle.boundingBox();
    const end = await target.boundingBox();
    assert.ok(start && end);
    await escapePage.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await escapePage.mouse.down();
    await escapePage.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 8,
    });
    assert.equal(await escapePage.locator(".arrange-dragging").count(), 1);
    await escapePage.keyboard.press("Escape");
    assert.equal(
      await escapePage.locator(".arrange-dragging").count(),
      0,
      "Escape cancels a drag started from header focus",
    );
    assert.equal(await escapePage.locator(".arrange-drop-active").count(), 0);
    await escapePage.mouse.up();
    await escapePage
      .getByRole("button", { name: "Select Yes, slot 1", exact: true })
      .waitFor();
    await escapePage
      .getByRole("button", { name: "Select No, slot 2", exact: true })
      .waitFor();
    assert.equal(
      await escapePage.locator(".communication-fullscreen").count(),
      fullscreen ? 1 : 0,
      "Escape retains fullscreen while cancelling drag",
    );
    assert.deepEqual(
      await escapePage.evaluate(() =>
        JSON.parse(localStorage.getItem("sayboard-v2")),
      ),
      fixture,
    );
    results.push({ headerFocusedDragEscape: "pass", fullscreen });
    await escapePage.close();
  }

  // Arrangement owns Escape while focused, including inside fullscreen.
  const fullscreenPage = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  await fullscreenPage.goto(origin);
  await openArrange(fullscreenPage);
  await fullscreenPage.evaluate(() =>
    Object.defineProperty(document, "fullscreenEnabled", { value: false }),
  );
  await fullscreenPage
    .getByRole("button", {
      name: "Enter fullscreen communication board",
      exact: true,
    })
    .click();
  await fullscreenPage
    .getByRole("button", { name: "Select Yes, slot 1", exact: true })
    .click();
  await fullscreenPage.keyboard.press("Escape");
  assert.equal(
    await fullscreenPage.locator(".communication-fullscreen").count(),
    1,
  );
  assert.equal(
    await fullscreenPage
      .locator('.arrange-select[aria-pressed="true"]')
      .count(),
    0,
  );
  await fullscreenPage
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  assert.equal(
    await fullscreenPage.locator(".communication-fullscreen").count(),
    1,
  );
  await fullscreenPage
    .getByRole("button", { name: "Say Yes", exact: true })
    .waitFor();
  results.push({
    arrangementFullscreen: "pass",
    escapeCancelsSelection: "pass",
  });
  await fullscreenPage.close();

  // Legacy imports exercise the actual storage load and save path, no file chooser.
  const page = await browser.newPage();
  await page.goto(origin);
  const legacy = JSON.parse(
    readFileSync("tests/fixtures/legacy-custom-board.json", "utf8"),
  );
  await page.evaluate((board) => {
    localStorage.clear();
    localStorage.setItem("sayboard-v1", JSON.stringify(board));
  }, legacy);
  await page.reload();
  await openArrange(page);
  await page.locator(".arrange-category-creator summary").click();
  await page
    .getByLabel("New category name", { exact: true })
    .fill("Legacy fixtures");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  const migrated = await page.evaluate(() => ({
    old: JSON.parse(localStorage.getItem("sayboard-v1")),
    current: JSON.parse(localStorage.getItem("sayboard-v2")),
  }));
  assert.deepEqual(migrated.old, legacy);
  assert.equal(migrated.current.tiles[0].kind, "word");
  assert.equal(migrated.current.tiles[0].phrase, legacy.tiles[0].phrase);
  results.push({ legacy: "pass", originalBytes: "retained" });
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
