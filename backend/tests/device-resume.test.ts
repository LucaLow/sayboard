import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

it("resumes legacy classroom devices through an unprivileged hint without changing the independent free app", async () => {
  const root = await mkdtemp(join(tmpdir(), "sayboard-device-resume-"));
  const staticDirectory = join(root, "dist");
  await mkdir(join(staticDirectory, "source"), { recursive: true });
  await writeFile(join(staticDirectory, "index.html"), "<main>Board</main>");
  await writeFile(
    join(staticDirectory, "source", "history.json"),
    '{"releases":[]}',
  );
  await writeFile(join(staticDirectory, "source", "current.json"), "{}");
  await writeFile(join(staticDirectory, "source", "index.html"), "Sources");
  try {
    for (const enabled of [true, false]) {
      const port = await availablePort();
      const server = await startServer({
        NODE_ENV: "production",
        SAYBOARD_AUTH_ENABLED: enabled ? "1" : "0",
        SAYBOARD_STORAGE: "sqlite",
        SAYBOARD_DATABASE_PATH: join(root, "board.sqlite"),
        SAYBOARD_ORIGIN: "https://classroom.example.test",
        SAYBOARD_PORT: String(port),
        SAYBOARD_STATIC_DIR: staticDirectory,
        SAYBOARD_DATA_DIR: join(root, "data"),
      });
      try {
        async function read(cookie?: string) {
          return new Promise<{
            status: number | undefined;
            cache: string | undefined;
            cookies: string[] | undefined;
            body: string;
          }>((resolve, reject) => {
            const outgoing = request(
              {
                hostname: "127.0.0.1",
                port,
                path: "/",
                headers: {
                  host: "classroom.example.test",
                  ...(cookie ? { cookie } : {}),
                },
              },
              (response) => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk: string) => {
                  body += chunk;
                });
                response.on("end", () =>
                  resolve({
                    status: response.statusCode,
                    cache: response.headers["cache-control"],
                    cookies: response.headers["set-cookie"],
                    body,
                  }),
                );
              },
            );
            outgoing.on("error", reject);
            outgoing.end();
          });
        }
        const token = "a".repeat(64);
        const linked = await read(`__Host-sayboard_device=${token}`);
        expect(linked.status).toBe(200);
        expect(linked.body).toBe("<main>Board</main>");
        expect(linked.body).not.toContain(token);
        if (enabled) {
          expect(linked.cache).toBe("private, no-store");
          expect(linked.cookies).toEqual([
            "sayboard_classroom=1; Path=/; SameSite=Strict; Max-Age=2592000; Secure",
          ]);
          expect((await read()).cookies).toEqual([
            "sayboard_classroom=; Path=/; SameSite=Strict; Max-Age=0; Secure",
          ]);
          expect(
            (await read("__Host-sayboard_device=invalid")).cookies?.[0],
          ).toContain("Max-Age=0");
        } else {
          expect(linked.cache).toBe("no-cache");
          expect(linked.cookies).toBeUndefined();
        }
      } finally {
        server.closeIdleConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
