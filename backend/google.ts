import { createHash } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { HttpError, json, sessionToken } from "./api-http.js";
import { requestRejection, SESSION_SECONDS } from "./api.js";
import type { HostedConfig } from "./config.js";
import { newToken, tokenHash } from "./password.js";
import type { Store } from "./store-contract.js";

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  allowSignup: boolean;
};
export function googleConfig(env: NodeJS.ProcessEnv): GoogleConfig | null {
  const id = env.SAYBOARD_GOOGLE_CLIENT_ID;
  const secret = env.SAYBOARD_GOOGLE_CLIENT_SECRET;
  const signup = env.SAYBOARD_GOOGLE_SIGNUP_ENABLED;
  if (![undefined, "", "0", "1"].includes(signup))
    throw new Error("Invalid Google signup setting");
  if (!id && !secret && signup !== "1") return null;
  if (
    !id ||
    !/^[a-zA-Z0-9_.-]{1,256}\.apps\.googleusercontent\.com$/.test(id) ||
    !secret ||
    secret.length > 2048 ||
    /\s/.test(secret) ||
    env.SAYBOARD_AUTH_ENABLED !== "1" ||
    env.SAYBOARD_STORAGE !== "sqlite"
  )
    throw new Error(
      "Google sign-in requires client credentials and hosted SQLite accounts",
    );
  return { clientId: id, clientSecret: secret, allowSignup: signup === "1" };
}

const productionEndpoints = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
};
// Overrides are a constructor dependency for local provider tests, never environment settings.
export class GoogleProvider {
  private keys;
  constructor(
    private readonly config: GoogleConfig,
    private readonly endpoints = productionEndpoints,
  ) {
    this.keys = createRemoteJWKSet(new URL(endpoints.jwks), {
      timeoutDuration: 5000,
      [customFetch]: async (url, options) => boundedFetch(url, options),
    });
  }
  authorization(
    callback: string,
    state: string,
    nonce: string,
    verifier: string,
  ): string {
    const url = new URL(this.endpoints.authorization);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: callback,
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      prompt: "select_account",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return url.href;
  }
  async subject(
    code: string,
    callback: string,
    nonce: string,
    verifier: string,
    now: number,
  ): Promise<string> {
    const response = await boundedFetch(this.endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: callback,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new Error("Google exchange failed");
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("id_token" in data) ||
      typeof data.id_token !== "string"
    )
      throw new Error("Invalid Google exchange");
    const { payload } = await jwtVerify(data.id_token, this.keys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: this.config.clientId,
      currentDate: new Date(now),
      maxTokenAge: "10m",
      requiredClaims: ["sub", "iat", "exp", "nonce", "email_verified"],
    });
    if (
      !payload.sub ||
      !/^[\x21-\x7e]{1,255}$/.test(payload.sub) ||
      payload.nonce !== nonce ||
      payload.email_verified !== true ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload.azp !== this.config.clientId) ||
      (payload.azp !== undefined && payload.azp !== this.config.clientId)
    )
      throw new Error("Invalid Google identity");
    return payload.sub;
  }
}

async function boundedFetch(
  url: string | URL,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (Number(response.headers.get("content-length")) > 64_000) {
    await response.body?.cancel();
    throw new Error("Oversized identity response");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64_000) {
          await reader.cancel();
          throw new Error("Oversized identity response");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    headers: response.headers,
  });
}

const attemptCookie = "__Host-sayboard_google";
const cookie = (token: string) =>
  `${attemptCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? 600 : 0}`;
const callbackPath = "/api/auth/google/callback";
export const isGoogleCallback = (request: Request) =>
  request.method === "GET" && new URL(request.url).pathname === callbackPath;

export function createGoogleHandler(
  store: Store,
  hosted: HostedConfig,
  config: GoogleConfig | null,
  now = Date.now,
  provider = config ? new GoogleProvider(config) : null,
) {
  const callback = hosted.origin + callbackPath;
  return async (request: Request, peer: string): Promise<Response> => {
    const url = new URL(request.url);
    const rejection = requestRejection(request, peer, hosted, {
      allowCrossSiteNavigation: isGoogleCallback(request),
    });
    if (rejection) return rejection;
    if (url.pathname === "/api/auth/google/config") {
      if (request.method !== "GET")
        return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
      if (url.search) return json(400, { error: "query_not_supported" });
      return json(200, {
        enabled: config !== null,
        signupEnabled: config?.allowSignup ?? false,
      });
    }
    if (!config || !provider || !store.google)
      return json(503, { error: "google_unconfigured" });
    if (url.pathname === "/api/auth/google/start") {
      if (request.method !== "POST")
        return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
      if (url.search) return json(400, { error: "query_not_supported" });
      try {
        if (!(await store.allowLogin("google-start:" + peer, now())))
          throw new HttpError(429, "too_many_attempts");
        const state = newToken();
        const browser = sessionToken(request, attemptCookie) ?? newToken();
        const attempt = { nonce: newToken(), verifier: newToken() };
        store.google.begin(
          tokenHash(state),
          tokenHash(browser),
          attempt,
          now(),
        );
        return json(
          200,
          {
            url: provider.authorization(
              callback,
              state,
              attempt.nonce,
              attempt.verifier,
            ),
          },
          { "Set-Cookie": cookie(browser), "Referrer-Policy": "no-referrer" },
        );
      } catch (error) {
        return json(error instanceof HttpError ? error.status : 503, {
          error: error instanceof HttpError ? error.code : "google_unavailable",
        });
      }
    }
    if (!isGoogleCallback(request)) return json(404, { error: "not_found" });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": cookie(""),
    });
    try {
      if (!(await store.allowLogin("google-callback:" + peer, now())))
        throw new HttpError(429, "too_many_attempts");
      const browser = sessionToken(request, attemptCookie);
      const state = url.searchParams.getAll("state");
      if (!browser || state.length !== 1 || !/^[a-f0-9]{64}$/.test(state[0]))
        throw new HttpError(403, "google_login_expired");
      const attempt = store.google.consume(
        tokenHash(state[0]),
        tokenHash(browser),
        now(),
      );
      if (url.searchParams.has("error"))
        throw new HttpError(400, "google_cancelled");
      const codes = url.searchParams.getAll("code");
      if (codes.length !== 1 || !codes[0] || codes[0].length > 4096)
        throw new HttpError(400, "google_login_failed");
      const subject = await provider.subject(
        codes[0],
        callback,
        attempt.nonce,
        attempt.verifier,
        now(),
      );
      const account = store.google.account(subject, config.allowSignup);
      // The Strict session cookie may be absent on the cross-site callback. Rotate it when present;
      // the browser's prior cookie is always replaced with a fresh random session.
      const previous = sessionToken(request, "__Host-sayboard_session");
      if (previous) await store.deleteSession(tokenHash(previous));
      const token = newToken();
      await store.createSession(
        tokenHash(token),
        account.id,
        now() + SESSION_SECONDS * 1000,
      );
      headers.append(
        "Set-Cookie",
        `__Host-sayboard_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}; Secure`,
      );
      headers.set("Location", "/teacher");
    } catch (error) {
      const reason =
        error instanceof HttpError && error.code === "google_signup_disabled"
          ? "signup-disabled"
          : error instanceof HttpError && error.code === "google_cancelled"
            ? "cancelled"
            : "failed";
      headers.set("Location", "/teacher#google=" + reason);
    }
    return new Response(null, { status: 303, headers });
  };
}
