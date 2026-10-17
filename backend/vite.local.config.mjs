// Optional local API proxy. Invoke explicitly; the static build stays unchanged.
export default {
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
};
