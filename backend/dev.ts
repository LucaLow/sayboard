import { localConfig } from "./config.js";
import { SqliteStore } from "./store.js";
import { createApi } from "./api.js";
import { localServer } from "./http.js";

// Validate environment BEFORE opening a database or seeding any credentials.
const config = localConfig(process.env);
process.umask(0o077);
const store = new SqliteStore(config.databasePath);
await store.seedLocalAdmin();
const server = localServer(await createApi(store, config));
server.listen(Number(new URL(config.apiOrigin).port || 80), "127.0.0.1", () => {
  process.stdout.write(`Sayboard local API at ${config.apiOrigin}.\n`);
});
function shutdown() {
  server.close(() => {
    store.close();
  });
  server.closeIdleConnections();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
