// Test subprocess only. Production code has no configurable identity endpoints.
const provider = process.env.SAYBOARD_TEST_GOOGLE_PROVIDER;
if (!provider || new URL(provider).hostname !== "127.0.0.1")
  throw new Error("A loopback provider fixture is required");
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input);
  const path =
    url === "https://oauth2.googleapis.com/token"
      ? "/token"
      : url === "https://www.googleapis.com/oauth2/v3/certs"
        ? "/keys"
        : null;
  return originalFetch(path ? provider + path : input, init);
};
