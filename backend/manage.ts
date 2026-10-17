import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { SqliteStore } from "./store.js";

async function main() {
  const [command, name, ...extra] = process.argv.slice(2);
  const path = process.env.SAYBOARD_DATABASE_PATH;
  if (
    process.env.NODE_ENV !== "production" ||
    !path ||
    !isAbsolute(path) ||
    process.env.SAYBOARD_STORAGE !== "sqlite"
  )
    throw new Error("Configure an absolute SQLite database path");
  if (
    !["create", "reset-password", "backup", "delete"].includes(command) ||
    !name ||
    (command === "delete"
      ? extra.length !== 1 || extra[0] !== `--confirm-delete=${name}`
      : extra.length !== 0)
  )
    throw new Error(
      "Use create USER, reset-password USER, backup DESTINATION or delete USER --confirm-delete=USER",
    );
  if (command !== "create" && !existsSync(path))
    throw new Error("An existing database is required");
  if (
    command !== "backup" &&
    (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || name.toLowerCase() === "admin")
  )
    throw new Error(
      "Choose a non-admin account name using letters, digits, underscores or hyphens",
    );
  if (command === "backup" && (!isAbsolute(name) || existsSync(name)))
    throw new Error("Use a new absolute backup path");
  process.umask(0o077);
  let password = "";
  if (command === "create" || command === "reset-password") {
    if (process.stdin.isTTY)
      throw new Error(
        "Supply the password on stdin using the hidden shell prompt documented in docs/SELF-HOSTING.md",
      );
    for await (const chunk of process.stdin) {
      password += chunk.toString();
      if (password.length > 258) throw new Error("Password too long");
    }
    password = password.replace(/\r?\n$/, "");
    if (password.length < 16 || password.length > 256)
      throw new Error("Use a password between 16 and 256 characters");
  }
  const store = new SqliteStore(path);
  try {
    if (command === "create") await store.addAccount(name, password, false);
    else if (command === "reset-password")
      await store.resetPassword(name, password);
    else if (command === "delete") store.deleteAccount(name);
    else await store.backup(name);
    console.log("Account maintenance completed.");
  } finally {
    store.close();
  }
}
void main().catch(() => {
  console.error(
    "Account maintenance failed. Check the command, database path and account name. Passwords need 16 to 256 characters on stdin.",
  );
  process.exitCode = 1;
});
