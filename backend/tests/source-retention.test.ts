import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { retainSources } from "../source-retention.js";

it("retains old source URLs across upgrades, accepts retries and rejects immutable changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sayboard-source-retention-"));
  const source = join(root, "bundled");
  const destination = join(root, "retained");
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  async function version(letter: string) {
    await rm(source, { recursive: true, force: true });
    const release = letter.repeat(64);
    await mkdir(join(source, release), { recursive: true });
    const manifest = JSON.stringify({ release });
    await writeFile(join(source, release, "manifest.json"), manifest);
    await writeFile(join(source, release, "frontend-source.tar.gz"), letter);
    await writeFile(
      join(source, "history.json"),
      JSON.stringify({
        releases: [{ release, manifestSha256: hash(manifest) }],
      }),
    );
    await writeFile(join(source, "current.json"), JSON.stringify({ release }));
    await writeFile(join(source, "index.html"), letter);
    return release;
  }
  try {
    const first = await version("a");
    await retainSources(source, destination);
    await retainSources(source, destination);
    const second = await version("b");
    await mkdir(join(destination, second));
    await writeFile(
      join(destination, second, "frontend-source.tar.gz.pending"),
      "interrupted write",
    );
    await retainSources(source, destination);
    expect(
      await readFile(
        join(destination, second, "frontend-source.tar.gz"),
        "utf8",
      ),
    ).toBe("b");
    expect(
      await readFile(
        join(destination, first, "frontend-source.tar.gz"),
        "utf8",
      ),
    ).toBe("a");
    expect(
      JSON.parse(await readFile(join(destination, "current.json"), "utf8")),
    ).toEqual({ release: second });
    expect(
      JSON.parse(await readFile(join(destination, "history.json"), "utf8"))
        .releases,
    ).toHaveLength(2);
    await writeFile(join(source, second, "frontend-source.tar.gz"), "changed");
    await expect(retainSources(source, destination)).rejects.toThrow(
      "Immutable source file changed",
    );
    await writeFile(
      join(source, "history.json"),
      '{"releases":[{"release":"../escape","manifestSha256":"x"}]}',
    );
    await expect(retainSources(source, destination)).rejects.toThrow(
      "Invalid source release",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
