import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// A returning teacher deliberately saves a tab-local example into an existing
// classroom. Fixture records use the actual authenticated SQLite API.
export async function checkTeacherExampleSave({
  browser,
  origin,
  username,
  password,
  engine,
  artifactDirectory,
}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: new URL(origin).hostname === "localhost",
    viewport:
      engine === "webkit"
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let classroomId;
  let headers;
  try {
    await page.goto(origin + "/teacher");
    await page.getByLabel("Teacher username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "Your classrooms", exact: true })
      .waitFor();
    const session = await (
      await context.request.get(origin + "/api/auth/session")
    ).json();
    headers = { Origin: origin, "X-CSRF-Token": session.csrfToken };
    const room = await context.request.post(origin + "/api/classrooms", {
      headers,
      data: { name: "Existing classroom " + engine },
    });
    assert.equal(room.status(), 201);
    classroomId = (await room.json()).id;
    const profile = await context.request.post(
      origin + `/api/classrooms/${classroomId}/profiles`,
      { headers, data: { label: "Existing learner" } },
    );
    assert.equal(profile.status(), 201);
    const original = await profile.json();
    await page.goto(origin + "/?teacherDemo=1");
    await page.getByRole("button", { name: "Say Yes", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Switch to dark mode", exact: true })
      .click();
    const contrast = await page
      .locator(".teacher-demo-banner")
      .evaluate((banner) => {
        const luminance = (color) => {
          const channels = color
            .match(/[0-9.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((channel) => {
              const value = channel / 255;
              return value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
            });
          return (
            channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
          );
        };
        const style = getComputedStyle(banner);
        const text = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(text, background) + 0.05) /
          (Math.min(text, background) + 0.05)
        );
      });
    assert.ok(contrast >= 4.5, "The dark example banner remains readable");
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true });
      await page.screenshot({
        path: artifactDirectory + `/teacher-demo-dark-${engine}.png`,
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Switch to light mode", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save to teacher workspace", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Keep the board you tried", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Create first board", exact: true })
        .count(),
      0,
    );
    await page
      .getByLabel("Save in classroom", { exact: true })
      .selectOption(classroomId);
    await page
      .getByLabel("Learner alias", { exact: true })
      .fill("New example learner");
    await page
      .getByRole("button", {
        name: "Save example as a new learner board",
        exact: true,
      })
      .click();
    await page
      .getByRole("heading", { name: "New example learner", exact: true })
      .waitFor();
    const unchanged = await (
      await context.request.get(origin + "/api/profiles/" + original.id)
    ).json();
    assert.deepEqual(unchanged.board, original.board);
    assert.equal(unchanged.revision, original.revision);
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("sayboard-teacher-demo-pending"),
      ),
      null,
    );
    // A pending example must not cross an explicit account sign-out.
    await page.goto(origin + "/?teacherDemo=1");
    await page
      .getByRole("button", { name: "Save to teacher workspace", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Keep the board you tried", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByText("Signed out.", { exact: true }).waitFor();
    await page.getByLabel("Teacher username", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("sayboard-teacher-demo-pending"),
      ),
      null,
    );
    return {
      engine,
      existingClassroomExampleSavedExplicitly: true,
      existingLearnerUnchanged: true,
      signOutClearsPendingExample: true,
      darkExampleBannerContrast: contrast,
    };
  } finally {
    if (classroomId) {
      const login = await context.request.post(origin + "/api/auth/login", {
        headers: { Origin: origin },
        data: { username, password },
      });
      const session = await login.json();
      await context.request.delete(origin + "/api/classrooms/" + classroomId, {
        headers: { Origin: origin, "X-CSRF-Token": session.csrfToken },
      });
    }
    await context.close();
  }
}
