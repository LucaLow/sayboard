import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Release = { release: string; manifestSha256: string };
function releases(value: unknown): Release[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("releases" in value) ||
    !Array.isArray(value.releases)
  )
    throw new Error("Invalid source history");
  return value.releases.map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("release" in item) ||
      !("manifestSha256" in item) ||
      typeof item.release !== "string" ||
      typeof item.manifestSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.release) ||
      !/^[a-f0-9]{64}$/.test(item.manifestSha256)
    )
      throw new Error("Invalid source release");
    return { release: item.release, manifestSha256: item.manifestSha256 };
  });
}
async function optional(path: string) {
  try {
    return await readFile(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/** Keep every previously served immutable source URL across image upgrades. */
export async function retainSources(bundled: string, destination: string) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const current = releases(
    JSON.parse(await readFile(join(bundled, "history.json"), "utf8")),
  );
  const previous = await optional(join(destination, "history.json"));
  const retained = previous
    ? releases(JSON.parse(previous.toString("utf8")))
    : [];
  const combined = new Map<string, Release>();
  for (const record of [...retained, ...current]) {
    const existing = combined.get(record.release);
    if (existing && existing.manifestSha256 !== record.manifestSha256)
      throw new Error("Immutable source release changed");
    combined.set(record.release, record);
  }
  async function copy(relative = "") {
    for (const entry of await readdir(join(bundled, relative), {
      withFileTypes: true,
    })) {
      const name = join(relative, entry.name);
      if (
        !relative &&
        ["history.json", "current.json", "index.html"].includes(entry.name)
      )
        continue;
      if (entry.isDirectory()) {
        await mkdir(join(destination, name), { recursive: true });
        await copy(name);
      } else if (entry.isFile()) {
        const data = await readFile(join(bundled, name));
        const old = await optional(join(destination, name));
        if (old && hash(old) !== hash(data))
          throw new Error("Immutable source file changed");
        if (!old) {
          await writeFile(join(destination, name + ".pending"), data);
          await rename(
            join(destination, name + ".pending"),
            join(destination, name),
          );
        }
      } else throw new Error("Source files must not contain symlinks");
    }
  }
  await copy();
  for (const record of combined.values()) {
    if (
      hash(
        await readFile(join(destination, record.release, "manifest.json")),
      ) !== record.manifestSha256
    )
      throw new Error("Retained source manifest mismatch");
  }
  async function replace(name: string, data: Uint8Array | string) {
    await writeFile(join(destination, name + ".pending"), data);
    await rename(join(destination, name + ".pending"), join(destination, name));
  }
  await replace(
    "history.json",
    JSON.stringify(
      {
        releases: [...combined.values()].sort((a, b) =>
          a.release.localeCompare(b.release),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  await replace("current.json", await readFile(join(bundled, "current.json")));
  await replace("index.html", await readFile(join(bundled, "index.html")));
}
