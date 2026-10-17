import { isAbsolute, resolve } from "node:path";

export type LocalConfig = {
  kind: "local";
  origin: string;
  apiOrigin: string;
  databasePath: string;
};

export type HostedConfig = { kind: "hosted"; origin: string };
export type ApiConfig = LocalConfig | HostedConfig;

export function hostedConfig(env: NodeJS.ProcessEnv): HostedConfig {
  if (
    env.NODE_ENV !== "production" ||
    env.SAYBOARD_AUTH_ENABLED !== "1" ||
    !["postgres", "sqlite"].includes(env.SAYBOARD_STORAGE ?? "") ||
    env.SAYBOARD_LOCAL_DEV ||
    (env.SAYBOARD_STORAGE === "postgres" && !env.DATABASE_URL) ||
    (env.SAYBOARD_STORAGE === "sqlite" &&
      (!env.SAYBOARD_DATABASE_PATH ||
        !isAbsolute(env.SAYBOARD_DATABASE_PATH))) ||
    !env.SAYBOARD_ORIGIN
  )
    throw new Error("Hosted authentication is not configured");
  let url: URL;
  try {
    url = new URL(env.SAYBOARD_ORIGIN);
  } catch {
    throw new Error("Invalid hosted origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.endsWith(".")
  )
    throw new Error("Hosted origin must be an exact HTTPS domain origin");
  return { kind: "hosted", origin: url.origin };
}

export function localConfig(env: NodeJS.ProcessEnv): LocalConfig {
  // Development credentials stay behind explicit loopback-only opt-in.
  if (
    env.SAYBOARD_LOCAL_DEV !== "1" ||
    env.NODE_ENV !== "development" ||
    Boolean(env.CI)
  )
    throw new Error(
      "Local authentication is disabled. Use explicit local development settings.",
    );
  const origin = loopbackOrigin(env.SAYBOARD_ORIGIN ?? "http://127.0.0.1:5188");
  const apiOrigin = loopbackOrigin(
    env.SAYBOARD_API_ORIGIN ?? "http://127.0.0.1:5190",
  );
  if (new URL(apiOrigin).hostname !== "127.0.0.1")
    throw new Error("The local API must bind to 127.0.0.1.");
  return {
    kind: "local",
    origin,
    apiOrigin,
    databasePath:
      env.SAYBOARD_DATABASE_PATH ?? resolve(".data/sayboard.sqlite"),
  };
}

function loopbackOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Local origins must be plain HTTP loopback origins.");
  return url.origin;
}
