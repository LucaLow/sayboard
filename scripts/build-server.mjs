import { build } from "esbuild";
import { rm, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
await rm("server-dist", { recursive: true, force: true });
const result = await build({
  entryPoints: { server: "backend/server.ts", manage: "backend/manage.ts" },
  outdir: "server-dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: false,
  metafile: true,
});
// Runtime bundles need the licences of their bundled server dependencies too.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.split("/").includes("node_modules")) continue;
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    try {
      const metadata = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (typeof metadata.name === "string") {
        packages.add(directory);
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
}
const notices = [];
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  const files = (await readdir(directory)).filter((name) =>
    /^(licen[cs]e|copying)(\.(txt|md))?$/i.test(name),
  );
  if (!files.length) {
    // pg-types 2.2.0 publishes its complete MIT notice in README.md.
    const readme = await readFile(join(directory, "README.md"), "utf8");
    const section = readme.match(/^##\s+licen[cs]e\s*\n([\s\S]+)/im)?.[1];
    if (!section || !/copyright/i.test(section) || !/permission/i.test(section))
      throw new Error(`Missing server dependency licence: ${metadata.name}`);
    notices.push(`${metadata.name} ${metadata.version}\n${section}`);
    continue;
  }
  notices.push(
    `${metadata.name} ${metadata.version}\n` +
      (await Promise.all(
        files.map((file) => readFile(join(directory, file), "utf8")),
      ).then((parts) => parts.join("\n"))),
  );
}
await writeFile(
  "server-dist/THIRD-PARTY-NOTICES.txt",
  notices.join("\n\n") + "\n",
);
