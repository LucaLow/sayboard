import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { startServer } from "../server.js";

async function availablePort() {
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve),
  );
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

it("refuses to start with incomplete email settings instead of disabling every account request", async () => {
  const root = await mkdtemp(join(tmpdir(), "sayboard-startup-"));
  const staticDirectory = join(root, "dist");
  await mkdir(join(staticDirectory, "source"), { recursive: true });
  await writeFile(join(staticDirectory, "index.html"), "<main>Board</main>");
  await writeFile(
    join(staticDirectory, "source", "history.json"),
    '{"releases":[]}',
  );
  await writeFile(join(staticDirectory, "source", "current.json"), "{}");
  await writeFile(join(staticDirectory, "source", "index.html"), "Sources");
  const env = async () => ({
    NODE_ENV: "production",
    SAYBOARD_AUTH_ENABLED: "1",
    SAYBOARD_STORAGE: "sqlite",
    SAYBOARD_DATABASE_PATH: join(root, "board.sqlite"),
    SAYBOARD_ORIGIN: "https://classroom.example.test",
    SAYBOARD_PORT: String(await availablePort()),
    SAYBOARD_STATIC_DIR: staticDirectory,
    SAYBOARD_DATA_DIR: join(root, "data"),
    SAYBOARD_SMTP_HOST: "smtp.example.test",
    SAYBOARD_SMTP_USER: "synthetic",
    SAYBOARD_SMTP_PASSWORD: "synthetic",
  });
  try {
    // A display-name sender is a common mistake; the address must be bare.
    await expect(
      startServer({
        ...(await env()),
        SAYBOARD_EMAIL_FROM: "Sayboard <accounts@example.test>",
      }),
    ).rejects.toThrow();
    await expect(startServer(await env())).rejects.toThrow();
    const server = await startServer({
      ...(await env()),
      SAYBOARD_EMAIL_FROM: "accounts@example.test",
    });
    server.closeIdleConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
