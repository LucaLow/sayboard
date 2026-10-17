import { build } from "esbuild";
import { rm } from "node:fs/promises";
await rm("server-dist", { recursive: true, force: true });
await build({
  entryPoints: { server: "backend/server.ts", manage: "backend/manage.ts" },
  outdir: "server-dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: false,
});
