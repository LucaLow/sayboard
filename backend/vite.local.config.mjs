// Optional local API proxy. Invoke explicitly; the static build stays unchanged.
import { mergeConfig } from "vite";
import base from "../vite.config.ts";
export default mergeConfig(base, {
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5190",
        changeOrigin: true,
        xfwd: false,
      },
    },
  },
});
