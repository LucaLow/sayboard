import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
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

it("serves retained source archives when the data directory is reached through a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "sayboard-source-route-"));
  const staticDirectory = join(root, "dist");
  await mkdir(join(staticDirectory, "source"), { recursive: true });
  await writeFile(join(staticDirectory, "index.html"), "<main>Board</main>");
  await writeFile(
    join(staticDirectory, "source", "history.json"),
    '{"releases":[]}',
  );
  await writeFile(
    join(staticDirectory, "source", "current.json"),
    '{"release":"synthetic"}',
  );
  await writeFile(join(staticDirectory, "source", "index.html"), "Sources");
  // For example, /var/lib/sayboard linked to a mounted volume.
  await mkdir(join(root, "volume"));
  await symlink(join(root, "volume"), join(root, "data"));
  const port = await availablePort();
  const server = await startServer({
    NODE_ENV: "production",
    SAYBOARD_ORIGIN: "https://classroom.example.test",
    SAYBOARD_PORT: String(port),
    SAYBOARD_STATIC_DIR: staticDirectory,
    SAYBOARD_DATA_DIR: join(root, "data"),
  });
  try {
    const response = await new Promise<{
      status: number | undefined;
      body: string;
    }>((resolve, reject) => {
      const outgoing = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/source/current.json",
          headers: { host: "classroom.example.test" },
        },
        (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            body += chunk;
          });
          incoming.on("end", () =>
            resolve({ status: incoming.statusCode, body }),
          );
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
    expect(response).toEqual({ status: 200, body: '{"release":"synthetic"}' });
  } finally {
    server.closeIdleConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});
