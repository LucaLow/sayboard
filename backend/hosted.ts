import { isIP } from "node:net";
import { hostedConfig } from "./config.js";
import { createApi, requestRejection } from "./api.js";
import { tokenHash } from "./password.js";
import type { Store } from "./store-contract.js";
import { smtpMailer } from "./mail.js";

const unavailable = (error: string) =>
  new Response(JSON.stringify({ error }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export function createHostedHandler(
  env: NodeJS.ProcessEnv,
  getStore: () => Promise<Store>,
  now = Date.now,
) {
  let pending: Promise<Awaited<ReturnType<typeof createApi>>> | undefined;
  let initializedOrigin: string | undefined;
  return async (request: Request, clientIp: string): Promise<Response> => {
    let config;
    try {
      config = hostedConfig(env);
    } catch {
      return unavailable("auth_unconfigured");
    }
    // The HTTP adapter supplies a client IP only after validating its proxy peer.
    const ip = clientIp;
    if (!ip || !isIP(ip)) return unavailable("trusted_peer_unavailable");
    const peer = tokenHash(`sayboard-peer:${ip.toLowerCase()}`);
    const rejection = requestRejection(request, peer, config);
    if (rejection) return rejection;
    if (pending && initializedOrigin !== config.origin)
      return unavailable("auth_unconfigured");
    initializedOrigin = config.origin;
    pending ??= Promise.resolve()
      .then(getStore)
      .then((store) => createApi(store, config, now, smtpMailer(env)));
    const attempt = pending;
    try {
      const api = await attempt;
      return await api(request, peer);
    } catch {
      if (pending === attempt) pending = undefined;
      return unavailable("storage_unavailable");
    }
  };
}
