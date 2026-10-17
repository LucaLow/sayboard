import { defineConfig } from "vite";
export default defineConfig({
  resolve: { alias: { phonemizer: new URL("./src/speech/phonemizer.ts", import.meta.url).pathname } },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/lucide/")) return "icons";
          if (id.endsWith("/catalogue-data.json")) return "emoji-data";
        },
      },
    },
  },
});
