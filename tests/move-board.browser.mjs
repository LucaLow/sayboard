// Exercise the old-origin recovery page with synthetic storage only.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
const preview = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5189";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(preview).hostname));
const board = { version: 2, tiles: [null], size: "standard", subBoards: [], voice: "", rate: 1 };
for (const type of [chromium, webkit]) {
  const browser = await type.launch();
  try {
    for (const raw of [JSON.stringify(board), "broken original board"]) {
      const context = await browser.newContext();
      await context.route("https://sayboard.vercel.app/**", async route => {
        const url = new URL(route.request().url());
        const response = await fetch(preview + url.pathname);
        await route.fulfill({ status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/octet-stream" }, body: Buffer.from(await response.arrayBuffer()) });
      });
      await context.addInitScript(value => localStorage.setItem("sayboard-v2", value), raw);
      const page = await context.newPage();
      await page.goto("https://sayboard.vercel.app/move-board.html");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: raw.startsWith("{") ? "Download my board" : "Download sayboard-v2 recovery data", exact: true }).click(),
      ]);
      const content = await readFile(await download.path(), "utf8");
      if (raw.startsWith("{")) assert.deepEqual(JSON.parse(content), board);
      else assert.equal(content, raw);
      assert.equal(await page.evaluate(() => localStorage.getItem("sayboard-v2")), raw);
      await context.close();
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(preview + "/move-board.html");
    await page.getByRole("heading", { name: "Open the old address to recover its board", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Download my board", exact: true }).count(), 0);
    await context.close();
  } finally { await browser.close(); }
}
console.log(JSON.stringify({ engines: ["chromium", "webkit"], oldOriginExport: true, rawRecovery: true, originalStoragePreserved: true, otherOriginsProtected: true }));
