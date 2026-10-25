// Real emitted server + HTTPS + SQLite. Only Google is a local provider fixture.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { chromium, webkit, request } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "sayboard-google-browser-"));
const artifacts = join(root, "test-results/google-signin");
await mkdir(artifacts, { recursive: true });
const port = Number(process.env.SAYBOARD_GOOGLE_CHECK_PORT ?? 24443);
const appPort = port + 1;
const origin = `https://localhost:${port}`;
const clientId = "synthetic-browser.apps.googleusercontent.com";
const clientSecret = randomBytes(24).toString("hex");
const password = "Synthetic password-only teacher login";
const databasePath = join(temporary, "sayboard.sqlite");
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
let subject = "synthetic-google-chromium";
let failing = false;
let exchanges = 0;
const codes = new Map();
let providerOrigin;
const provider = createHttpServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, "http://localhost");
    if (url.pathname === "/keys") {
      outgoing.setHeader("Content-Type", "application/json");
      outgoing.end(
        JSON.stringify({
          keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "browser-fixture" }],
        }),
      );
      return;
    }
    if (url.pathname === "/authorize") {
      assert.equal(url.searchParams.get("scope"), "openid email");
      assert.equal(url.searchParams.get("client_id"), clientId);
      assert.equal(
        url.searchParams.get("redirect_uri"),
        origin + "/api/auth/google/callback",
      );
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      const code = randomBytes(20).toString("hex");
      codes.set(code, {
        nonce: url.searchParams.get("nonce"),
        challenge: url.searchParams.get("code_challenge"),
        callback: url.searchParams.get("redirect_uri"),
        state: url.searchParams.get("state"),
        subject,
      });
      outgoing.setHeader("Content-Type", "text/html; charset=utf-8");
      outgoing.end(
        `<h1>Demonstration Google account</h1><a href="/approve?code=${code}">Use demonstration Google account</a>`,
      );
      return;
    }
    if (url.pathname === "/approve") {
      const code = url.searchParams.get("code");
      const pending = codes.get(code);
      assert.ok(pending);
      const callback = new URL(pending.callback);
      callback.search = new URLSearchParams({
        code,
        state: pending.state,
      }).toString();
      outgoing.writeHead(302, { Location: callback.href });
      outgoing.end();
      return;
    }
    if (url.pathname === "/token") {
      exchanges++;
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const input = new URLSearchParams(Buffer.concat(chunks).toString());
      const pending = codes.get(input.get("code"));
      codes.delete(input.get("code"));
      assert.ok(pending);
      assert.equal(input.get("client_secret"), clientSecret);
      assert.equal(input.get("client_id"), clientId);
      assert.equal(input.get("redirect_uri"), pending.callback);
      assert.equal(
        createHash("sha256")
          .update(input.get("code_verifier"))
          .digest("base64url"),
        pending.challenge,
      );
      if (failing) {
        outgoing.writeHead(503);
        outgoing.end("Synthetic private provider error");
        return;
      }
      const token = await new SignJWT({
        nonce: pending.nonce,
        email_verified: true,
      })
        .setProtectedHeader({ alg: "RS256", kid: "browser-fixture" })
        .setIssuer("https://accounts.google.com")
        .setAudience(clientId)
        .setSubject(pending.subject)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      outgoing.setHeader("Content-Type", "application/json");
      outgoing.end(JSON.stringify({ id_token: token }));
      return;
    }
    outgoing.writeHead(404);
    outgoing.end();
  } catch {
    outgoing.writeHead(500);
    outgoing.end("Synthetic provider assertion failed");
  }
});
await new Promise((done, reject) => {
  provider.once("error", reject);
  provider.listen(0, "127.0.0.1", done);
});
providerOrigin = `http://127.0.0.1:${provider.address().port}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  SAYBOARD_SERVER_ENTRY: "1",
  SAYBOARD_ORIGIN: origin,
  SAYBOARD_PORT: String(appPort),
  SAYBOARD_STORAGE: "sqlite",
  SAYBOARD_DATABASE_PATH: databasePath,
  SAYBOARD_DATA_DIR: join(temporary, "data"),
  SAYBOARD_AUTH_ENABLED: "1",
};
for (const name of Object.keys(env))
  if (/^SAYBOARD_(GOOGLE|SMTP|EMAIL|LOCAL_DEV|TEST_GOOGLE)/.test(name))
    delete env[name];
execFileSync(
  process.execPath,
  ["server-dist/manage.cjs", "create", "password_teacher"],
  { cwd: root, env, input: password, stdio: ["pipe", "ignore", "pipe"] },
);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(temporary, "key.pem"),
    "-out",
    join(temporary, "cert.pem"),
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-days",
    "1",
  ],
  { stdio: "ignore" },
);
let serverLog = "";
let app;
let activePage;
let activeBrowser;
const navigationChecks = [];
const proxy = createHttpsServer(
  {
    key: await readFile(join(temporary, "key.pem")),
    cert: await readFile(join(temporary, "cert.pem")),
  },
  (incoming, outgoing) => {
    if (incoming.url === "/api/auth/google/start")
      navigationChecks.push({
        path: incoming.url,
        origin: incoming.headers.origin ?? "absent",
        site: incoming.headers["sec-fetch-site"] ?? "absent",
        mode: incoming.headers["sec-fetch-mode"] ?? "absent",
      });
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: appPort,
        path: incoming.url,
        method: incoming.method,
        headers: {
          ...incoming.headers,
          host: `localhost:${port}`,
          "x-forwarded-host": `localhost:${port}`,
          "x-forwarded-proto": "https",
          "x-forwarded-for": "127.0.0.1",
        },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", (error) => {
      navigationChecks.push({
        path: new URL(incoming.url, origin).pathname,
        upstreamError: error.code ?? "unknown",
      });
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  },
);
await new Promise((done, reject) => {
  proxy.once("error", reject);
  proxy.listen(port, "127.0.0.1", done);
});
const client = await request.newContext({
  baseURL: origin,
  ignoreHTTPSErrors: true,
});
async function stop() {
  const child = app;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((done) => {
    // Capture this process and cancel its watchdog before a replacement starts.
    // The old timer must never terminate a newly assigned `app`.
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
    watchdog.unref();
    child.once("exit", () => {
      clearTimeout(watchdog);
      done();
    });
    child.kill("SIGTERM");
  });
}
async function start(google) {
  await stop();
  const settings = {
    ...env,
    ...(google
      ? {
          SAYBOARD_GOOGLE_CLIENT_ID: clientId,
          SAYBOARD_GOOGLE_CLIENT_SECRET: clientSecret,
          SAYBOARD_GOOGLE_SIGNUP_ENABLED: "1",
          SAYBOARD_TEST_GOOGLE_PROVIDER: providerOrigin,
        }
      : {}),
  };
  app = spawn(
    process.execPath,
    [
      ...(google
        ? ["--import", join(root, "tests/fixtures/google-fetch-hook.mjs")]
        : []),
      "server-dist/server.cjs",
    ],
    { cwd: root, env: settings, stdio: ["ignore", "pipe", "pipe"] },
  );
  app.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
  app.stderr.on("data", (chunk) => (serverLog += chunk.toString()));
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await client.get("/healthz")).ok()) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error("Emitted server failed to start: " + serverLog);
}
function resetBudgets() {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA busy_timeout=5000; DELETE FROM login_limits");
  db.close();
}
const report = {
  server: "emitted Node server + HTTPS proxy + real SQLite",
  provider: "local signed OIDC fixture, not real Google tenant",
  engines: [],
};
try {
  await start(false);
  assert.deepEqual(await (await client.get("/api/auth/google/config")).json(), {
    enabled: false,
    signupEnabled: false,
  });
  for (const [engine, type] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    resetBudgets();
    const browser = await type.launch();
    activeBrowser = browser;
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        /google|authorize|approve|api\/auth\/|api\/classrooms/.test(
          url.pathname,
        )
      )
        navigationChecks.push({
          path: url.pathname,
          status: response.status(),
        });
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/teacher");
    assert.equal(
      await page
        .getByRole("button", { name: "Continue with Google", exact: true })
        .count(),
      0,
    );
    await page
      .getByLabel("Teacher username", { exact: true })
      .fill("password_teacher");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "Your classrooms", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await context.close();
    await browser.close();
    assert.deepEqual(errors, []);
    report.engines.push({
      engine,
      disabledFallback: true,
      existingPasswordLogin: true,
    });
  }
  await start(true);
  // Regression check: the previous server's five-second shutdown watchdog must
  // not terminate this replacement, even if browser interaction takes longer.
  await new Promise((done) => setTimeout(done, 6000));
  assert.equal(
    (await client.get("/healthz")).status(),
    200,
    "Restarted server survives the previous process shutdown watchdog",
  );
  report.restartWatchdogDoesNotKillReplacement = true;
  for (const [engine, type] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    resetBudgets();
    subject = "synthetic-google-" + engine;
    const browser = await type.launch();
    activeBrowser = browser;
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 },
    });
    await context.route(
      "https://accounts.google.com/o/oauth2/v2/auth?*",
      async (route) => {
        const incoming = new URL(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body:
            "<!doctype html><script>location.replace(" +
            JSON.stringify(providerOrigin + "/authorize" + incoming.search) +
            ")</script>",
        });
      },
    );
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        /google|authorize|approve|api\/auth\/|api\/classrooms/.test(
          url.pathname,
        )
      )
        navigationChecks.push({
          path: url.pathname,
          status: response.status(),
        });
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/teacher");
    const signIn = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    await signIn.waitFor();
    await signIn.focus();
    await signIn.press("Tab");
    assert.equal(
      await page
        .getByLabel("Teacher username", { exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.screenshot({
      path: join(artifacts, `google-login-${engine}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(artifacts, `google-login-narrow-${engine}.png`),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const startResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/auth/google/start",
    );
    await signIn.click();
    assert.equal((await startResponse).status(), 200);
    await page
      .getByRole("link", {
        name: "Use demonstration Google account",
        exact: true,
      })
      .click();
    await page
      .getByRole("heading", { name: "Your classrooms", exact: true })
      .waitFor();
    assert.equal(new URL(page.url()).pathname, "/teacher");
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(
      await page
        .getByRole("heading", { name: "Invite a teacher", exact: true })
        .count(),
      0,
    );
    const cookies = await context.cookies(origin);
    const session = cookies.find((c) => c.name === "__Host-sayboard_session");
    assert.ok(
      session?.secure && session.httpOnly && session.sameSite === "Strict",
    );
    assert.equal(
      cookies.some((c) => c.name === "__Host-sayboard_google"),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) =>
          /token|session|password/i.test(key),
        ),
      ),
      false,
    );
    const sessionResponse = await context.request.get(
      origin + "/api/auth/session",
    );
    assert.equal(sessionResponse.status(), 200);
    const credentials = await sessionResponse.json();
    const created = await context.request.post(origin + "/api/classrooms", {
      headers: { Origin: origin, "X-CSRF-Token": credentials.csrfToken },
      data: { name: "Google classroom " + engine },
    });
    assert.equal(created.status(), 201);
    await page.reload();
    await page
      .getByRole("heading", { name: "Google classroom " + engine, exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("button", { name: "Continue with Google", exact: true })
      .click();
    await page
      .getByRole("link", {
        name: "Use demonstration Google account",
        exact: true,
      })
      .click();
    await page
      .getByRole("heading", { name: "Your classrooms", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "Google classroom " + engine, exact: true })
      .waitFor();
    await page.screenshot({
      path: join(artifacts, `google-returning-${engine}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    resetBudgets();
    for (let attempt = 0; attempt < 10; attempt++) {
      const started = await context.request.post(
        origin + "/api/auth/google/start",
        { headers: { Origin: origin } },
      );
      assert.equal(started.status(), 200);
    }
    await page
      .getByRole("button", { name: "Continue with Google", exact: true })
      .click();
    await page
      .getByText(
        "Google sign-in could not start. Try again or use your teacher username.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Continue with Google", exact: true })
        .isEnabled(),
      true,
    );
    resetBudgets();
    failing = true;
    await page
      .getByRole("button", { name: "Continue with Google", exact: true })
      .click();
    await page
      .getByRole("link", {
        name: "Use demonstration Google account",
        exact: true,
      })
      .click();
    await page
      .getByText(
        "Google sign-in did not finish. Try again or use your teacher username. Your saved boards have not changed.",
        { exact: true },
      )
      .waitFor();
    failing = false;
    assert.equal(new URL(page.url()).hash, "");
    await page
      .getByLabel("Teacher username", { exact: true })
      .fill("password_teacher");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "Your classrooms", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("heading", {
          name: "Google classroom " + engine,
          exact: true,
        })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    report.engines.find((entry) => entry.engine === engine).google = {
      newTeacher: true,
      returningSameClassroom: true,
      onlyOrdinaryPermissions: true,
      nativeCrossSiteCallbackCookies: true,
      providerFailureRecoverable: true,
      startFailureRetry: true,
      existingPasswordLoginWhenGoogleEnabled: true,
      narrowLayout: true,
      keyboardFocus: true,
      errors,
    };
    await context.close();
    await browser.close();
  }
  assert.ok(exchanges >= 6);
  assert.ok(!serverLog.includes(clientSecret));
  assert.ok(!serverLog.includes("Synthetic private provider error"));
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify({ ...report, passed: true }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, artifacts, report }));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({
      path: join(artifacts, "failure.png"),
      fullPage: true,
    });
    await writeFile(
      join(artifacts, "failure.txt"),
      await activePage.locator("body").innerText(),
    );
  }
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify(
      { ...report, passed: false, navigationChecks, failure: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await activeBrowser?.close();
  await client.dispose();
  await stop();
  proxy.closeAllConnections();
  provider.closeAllConnections();
  await Promise.all([
    new Promise((done) => proxy.close(done)),
    new Promise((done) => provider.close(done)),
  ]);
  await rm(temporary, { recursive: true, force: true });
}
