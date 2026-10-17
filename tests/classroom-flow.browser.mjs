import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Uses the actual app, authentication cookies, API and SQLite store. The caller
// provides synthetic credentials from an isolated test installation.
export async function checkClassroomFlow({
  browser,
  origin,
  username,
  password,
  engine,
  artifactDirectory,
}) {
  const teacher = await browser.newContext({
    ignoreHTTPSErrors: new URL(origin).hostname === "localhost",
    viewport:
      engine === "webkit"
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
  });
  const device = await browser.newContext({
    ignoreHTTPSErrors: new URL(origin).hostname === "localhost",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const errors = [];
  const page = await teacher.newPage();
  const tablet = await device.newPage();
  for (const current of [page, tablet]) {
    current.setDefaultTimeout(15000);
    current.on("pageerror", (e) => errors.push(e.message));
  }
  const confirm = (current) =>
    current.getByRole("button", { name: "Confirm", exact: true }).click();
  const editDevice = async () => {
    await tablet
      .getByRole("button", { name: "Caregiver controls", exact: true })
      .click();
    await tablet
      .getByRole("button", { name: "Edit board and settings", exact: true })
      .click();
    await tablet
      .locator("summary")
      .filter({ hasText: "Backup and transfer" })
      .click();
  };
  const applyPublication = async (check = false) => {
    await editDevice();
    if (check)
      await tablet
        .getByRole("button", {
          name: "Check classroom connection",
          exact: true,
        })
        .click();
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .click();
    await confirm(tablet);
    await tablet
      .getByRole("button", { name: "Save board", exact: true })
      .click();
  };
  try {
    await page.goto(origin + "/teacher.html");
    await page.getByLabel("Teacher username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "Your classrooms", exact: true })
      .waitFor();
    const classroomName = "Demonstration " + engine;
    await page
      .getByLabel("Classroom name", { exact: true })
      .fill(classroomName);
    await page
      .getByRole("button", { name: "Create classroom", exact: true })
      .click();
    await page
      .getByLabel("Profile alias", { exact: true })
      .fill("Demo learner");
    await page
      .getByRole("button", { name: "Add profile", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Demo learner", exact: true })
      .waitFor();
    const ids = new URL(page.url()).hash.slice(1).split("/");
    assert.equal(ids.length, 2);
    const marker = {
      version: 2,
      size: "standard",
      voice: "",
      rate: 1,
      subBoards: [],
      tiles: [
        {
          kind: "word",
          id: "teacher-local-marker",
          label: "Keep my local board",
          phrase: "Keep my local board",
          icon: "heart",
          tone: "mint",
        },
      ],
    };
    await page.evaluate(
      (value) => localStorage.setItem("sayboard-v2", JSON.stringify(value)),
      marker,
    );
    const changeDraft = async (previous, next) => {
      await page.getByRole("link", { name: "Edit board", exact: true }).click();
      await page
        .getByRole("heading", { name: "Edit Demo learner", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Edit " + previous, exact: true })
        .click();
      await page.getByLabel("Text on the tile", { exact: true }).fill(next);
      await page.getByLabel("Text to speak", { exact: true }).fill(next);
      await page
        .getByRole("button", { name: "Apply changes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save classroom draft", exact: true })
        .click();
      await page.waitForURL(/\/teacher\.html#/);
      await page
        .getByRole("heading", { name: "Demo learner", exact: true })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("sayboard-v2")),
        ),
        marker,
        "Teacher editing must not replace the local communication board",
      );
    };
    await changeDraft("Yes", "Published one");
    await page
      .getByRole("link", { name: "Preview board", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Say Published one", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Caregiver controls", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Open Drink category", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Say Water", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Teacher dashboard", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Demo learner", exact: true })
      .waitFor();
    const publish = async () => {
      await page
        .getByRole("button", { name: "Publish saved draft", exact: true })
        .click();
      await confirm(page);
    };
    await publish();
    await page
      .getByRole("heading", { name: "Version 1", exact: true })
      .waitFor();
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true });
      await page.screenshot({
        path: artifactDirectory + `/teacher-${engine}.png`,
        fullPage: true,
      });
    }
    await page.getByLabel("Device name", { exact: true }).fill("Demo tablet");
    await page
      .getByRole("button", { name: "Create pairing code", exact: true })
      .click();
    const pairing = await page.locator(".teacher-pairing code").innerText();
    assert.match(pairing, /^[A-F0-9]{10}$/);
    await tablet.goto(origin);
    await editDevice();
    const beforePairing = await tablet.evaluate(() =>
      localStorage.getItem("sayboard-v2"),
    );
    await tablet
      .getByLabel("Classroom pairing code", { exact: true })
      .fill(pairing);
    await tablet
      .getByRole("button", { name: "Link classroom device", exact: true })
      .click();
    await confirm(tablet);
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .waitFor();
    assert.equal(
      await tablet.evaluate(() => localStorage.getItem("sayboard-v2")),
      beforePairing,
      "Linking must not replace or upload the working local board",
    );
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .click();
    await confirm(tablet);
    assert.equal(
      await tablet.evaluate(() => localStorage.getItem("sayboard-v2")),
      beforePairing,
      "Loading a publication must remain an unsaved draft",
    );
    await tablet
      .getByRole("button", { name: "Save board", exact: true })
      .click();
    await tablet
      .getByRole("button", { name: "Say Published one", exact: true })
      .waitFor();
    await tablet.reload();
    await tablet
      .getByRole("button", { name: "Say Published one", exact: true })
      .waitFor();
    const denied = await device.request.get(origin + "/api/classrooms");
    assert.equal(denied.status(), 401);
    // Keep the learner panel open with version 1 while the teacher publishes.
    // Loading must fetch the latest board, without a separate connection check.
    await editDevice();
    await tablet
      .getByRole("button", { name: "Check classroom connection", exact: true })
      .click();
    await tablet
      .getByText("Linked to Demo learner. Published version 1 is available.", {
        exact: true,
      })
      .waitFor();
    const beforeUpdate = await tablet.evaluate(() =>
      localStorage.getItem("sayboard-v2"),
    );
    await changeDraft("Published one", "Published two");
    await publish();
    await page
      .getByRole("heading", { name: "Version 2", exact: true })
      .waitFor();
    assert.equal(
      await tablet.evaluate(() => localStorage.getItem("sayboard-v2")),
      beforeUpdate,
      "Publishing must not replace the working board or caregiver draft",
    );
    await tablet
      .getByRole("button", { name: "Edit Published one", exact: true })
      .waitFor();
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .click();
    await tablet
      .getByText(
        "Load version 2 into this caregiver draft? This replaces this draft. Save board applies it on this device.",
        { exact: true },
      )
      .waitFor();
    await confirm(tablet);
    await tablet
      .getByRole("button", { name: "Save board", exact: true })
      .click();
    await tablet
      .getByRole("button", { name: "Say Published two", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Restore version 1 to draft", exact: true })
      .click();
    await confirm(page);
    await page
      .getByText(
        "Version 1 restored into the draft. Preview it before publishing.",
        { exact: true },
      )
      .waitFor();
    await tablet
      .getByRole("button", { name: "Say Published two", exact: true })
      .waitFor();
    await publish();
    await page
      .getByRole("heading", { name: "Version 3", exact: true })
      .waitFor();
    await applyPublication(true);
    await tablet
      .getByRole("button", { name: "Say Published one", exact: true })
      .waitFor();
    await editDevice();
    await tablet
      .getByRole("button", { name: "Check classroom connection", exact: true })
      .click();
    await tablet
      .getByText("Linked to Demo learner. Published version 3 is available.", {
        exact: true,
      })
      .waitFor();
    const beforeInterruptedLoad = await tablet.evaluate(() =>
      localStorage.getItem("sayboard-v2"),
    );
    await device.setOffline(true);
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .click();
    await tablet
      .getByText(
        "The classroom service could not be reached. Your device board is unchanged. Try again when connected.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await tablet.evaluate(() => localStorage.getItem("sayboard-v2")),
      beforeInterruptedLoad,
    );
    await device.setOffline(false);
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .click();
    await tablet
      .getByText(
        "Load version 3 into this caregiver draft? This replaces this draft. Save board applies it on this device.",
        { exact: true },
      )
      .waitFor();
    // A publication arriving during the confirmation must not load silently.
    await changeDraft("Published one", "Published three");
    await publish();
    await page
      .getByRole("heading", { name: "Version 4", exact: true })
      .waitFor();
    await confirm(tablet);
    await tablet
      .getByText(
        "The published version changed while you were confirming. Your draft is unchanged. Choose Load published board again to review the latest version.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await tablet.evaluate(() => localStorage.getItem("sayboard-v2")),
      beforeInterruptedLoad,
    );
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .click();
    await tablet
      .getByText(
        "Load version 4 into this caregiver draft? This replaces this draft. Save board applies it on this device.",
        { exact: true },
      )
      .waitFor();
    await confirm(tablet);
    await tablet
      .getByRole("button", { name: "Save board", exact: true })
      .click();
    await editDevice();
    await tablet
      .getByRole("button", { name: "Check classroom connection", exact: true })
      .click();
    await tablet
      .getByText("Linked to Demo learner. Published version 4 is available.", {
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Refresh saved draft", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Revoke Demo tablet", exact: true })
      .click();
    await confirm(page);
    await page.getByText("Device access revoked.", { exact: true }).waitFor();
    await tablet
      .getByRole("button", { name: "Load published board", exact: true })
      .click();
    await tablet
      .getByText(
        "Sign in again, or link this device with a new code. Your device board is unchanged.",
        { exact: true },
      )
      .waitFor();
    await tablet
      .getByRole("button", { name: "Back to board", exact: true })
      .click();
    await tablet
      .getByRole("button", { name: "Say Published three", exact: true })
      .waitFor();
    await tablet.reload();
    await tablet
      .getByRole("button", { name: "Say Published three", exact: true })
      .waitFor();
    await device.setOffline(true);
    assert.ok(
      await tablet
        .getByRole("button", { name: "Say Published three", exact: true })
        .isVisible(),
    );
    await page
      .getByRole("button", { name: "Back to " + classroomName, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete classroom", exact: true })
      .click();
    await confirm(page);
    await page
      .getByRole("heading", { name: "Your classrooms", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Teacher username", { exact: true }).waitFor();
    assert.equal(
      (await teacher.request.get(origin + "/api/classrooms")).status(),
      401,
    );
    assert.deepEqual(errors, []);
    return {
      engine,
      teacherLogin: true,
      createClassroomAndProfile: true,
      existingEditorSavesServerDraft: true,
      teacherLocalBoardUnchanged: true,
      actualBoardPreview: true,
      explicitPublicationAndDeviceApply: true,
      publishedBoardSurvivesReload: true,
      latestPublicationWithoutManualRefresh: true,
      publicationChangedDuringConfirmationRejected: true,
      offlineLoadPreservesWorkingBoard: true,
      revokedDeviceCannotLoadCachedPublication: true,
      rollback: true,
      deviceCannotAccessTeacherData: true,
      revocationKeepsLocalBoard: true,
      classroomDeleted: true,
      logout: true,
      errors,
    };
  } catch (error) {
    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true });
      await page.screenshot({
        path: artifactDirectory + `/teacher-failure-${engine}.png`,
        fullPage: true,
      });
      await tablet.screenshot({
        path: artifactDirectory + `/device-failure-${engine}.png`,
        fullPage: true,
      });
    }
    throw error;
  } finally {
    await teacher.close();
    await device.close();
  }
}
