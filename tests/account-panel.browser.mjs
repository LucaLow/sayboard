// Stubbed account API with synthetic credentials. Editor re-renders recreate
// the account panel; the signed-out session check must not repeat or collide.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.SAYBOARD_PREVIEW_URL || "http://127.0.0.1:5189";
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname),
  "Use a local preview with synthetic data",
);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  const context = await browser.newContext();
  const requests = [];
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/auth/capabilities")
      return route.fulfill({ json: { state: "enabled" } });
    if (path === "/api/auth/session") {
      // Hold the check open so the first re-renders overlap it.
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
    }
    if (path === "/api/auth/login")
      return route.fulfill({
        json: {
          account: { username: "caregiver-test" },
          csrfToken: "csrf-test-only",
          expiresAt: 2_000_000_000,
        },
      });
    if (path === "/api/auth/logout") return route.fulfill({ json: {} });
    return route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    speechSynthesis.getVoices = () => [];
  });
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Caregiver controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit board and settings", exact: true })
    .click();
  const panel = () =>
    page
      .locator(".account-panel")
      .filter({ has: page.locator("h2", { hasText: /^Account backup$/ }) });
  const rerender = () => page.locator(".edit-row .move-down").first().click();
  const showsNotice = (text) =>
    panel()
      .locator(".notice", { hasText: text })
      .waitFor({ state: "attached" });
  const openBackups = () =>
    page
      .locator("details", {
        has: page.locator("summary", { hasText: "Backup and transfer" }),
      })
      .evaluate((details) => (details.open = true));
  const sessionChecks = () =>
    requests.filter((path) => path === "/api/auth/session").length;

  for (let i = 0; i < 4; i++) await rerender();
  await showsNotice("You are signed out.");
  for (let i = 0; i < 3; i++) await rerender();
  await showsNotice("You are signed out.");
  assert.equal(sessionChecks(), 1);

  await openBackups();
  await panel()
    .getByLabel("Account username", { exact: true })
    .fill("caregiver-test");
  await panel()
    .getByLabel("Account password", { exact: true })
    .fill("synthetic-test-only");
  await panel().getByRole("button", { name: "Sign in", exact: true }).click();
  await showsNotice("Signed in. No board was uploaded.");
  await rerender();
  await panel()
    .filter({ hasText: "Signed in as caregiver-test" })
    .waitFor({ state: "attached" });
  await openBackups();
  await panel().getByRole("button", { name: "Sign out", exact: true }).click();
  await showsNotice("Signed out. The board on this device is unchanged.");
  await rerender();
  await showsNotice("You are signed out.");
  assert.equal(sessionChecks(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sessionChecks: sessionChecks(), errors }));
} finally {
  await browser.close();
}
