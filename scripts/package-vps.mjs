// Build a runtime-only amd64 image away from a small VPS. No credentials or
// development files enter its context. Run the ordinary checks and build first.
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const platform = process.env.SAYBOARD_VPS_PLATFORM ?? "linux/amd64";
if (!["linux/amd64", "linux/arm64"].includes(platform))
  throw new Error("Use linux/amd64 or linux/arm64 for SAYBOARD_VPS_PLATFORM");
const [tag, destination, ...extra] = process.argv.slice(2);
if (
  !tag ||
  !/^sayboard:[a-z0-9][a-z0-9_.-]{0,100}$/.test(tag) ||
  !destination ||
  extra.length
)
  throw new Error(
    "Use node scripts/package-vps.mjs sayboard:RELEASE OUTPUT.tar",
  );
const archive = resolve(destination);
if (!archive.endsWith(".tar")) throw new Error("Use a .tar output path");
if (
  await stat(archive).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  )
)
  throw new Error("Output already exists; use a new release path");
const temporary = await mkdtemp(resolve(tmpdir(), "sayboard-runtime-"));
function command(args) {
  return new Promise((accept, reject) => {
    const process = spawn("docker", args, { cwd: root, stdio: "inherit" });
    process.once("error", reject);
    process.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error("Docker packaging failed")),
    );
  });
}
try {
  for (const file of [
    "dist/index.html",
    "dist/source/current.json",
    "server-dist/server.cjs",
    "server-dist/manage.cjs",
    "server-dist/THIRD-PARTY-NOTICES.txt",
  ])
    await stat(resolve(root, file));
  await cp(resolve(root, "dist"), resolve(temporary, "dist"), {
    recursive: true,
  });
  await cp(resolve(root, "server-dist"), resolve(temporary, "server-dist"), {
    recursive: true,
  });
  await cp(
    resolve(root, "deploy/Dockerfile.runtime"),
    resolve(temporary, "Dockerfile"),
  );
  await command(["build", `--platform=${platform}`, "--tag", tag, temporary]);
  await mkdir(dirname(archive), { recursive: true });
  await command(["save", "--output", archive, tag]);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  const source = JSON.parse(
    await readFile(resolve(root, "dist/source/current.json"), "utf8"),
  );
  const manifest = {
    tag,
    platform,
    sha256,
    bytes: (await stat(archive)).size,
    sourceRelease: source.release,
  };
  await writeFile(archive + ".json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
