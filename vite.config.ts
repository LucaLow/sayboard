import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  resolve: {
    alias: {
      phonemizer: fileURLToPath(
        new URL("./src/speech/phonemizer.ts", import.meta.url),
      ),
    },
  },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      input: {
        board: fileURLToPath(new URL("./index.html", import.meta.url)),
        teacher: fileURLToPath(new URL("./teacher.html", import.meta.url)),
        move: fileURLToPath(new URL("./move-board.html", import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/lucide/")) return "icons";
          if (id.endsWith("/catalogue-data.json")) return "emoji-data";
        },
      },
    },
  },
});
