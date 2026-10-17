import { hostedConfig } from "./config.js";

// Configuration discovery only. Enabled does not assert database health.
export function createHostedCapabilitiesHandler(env: NodeJS.ProcessEnv) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (request.method !== "GET")
      return new Response('{"error":"method_not_allowed"}', {
        status: 405,
        headers: { ...headers, Allow: "GET" },
      });
    try {
      // A broken hosting boundary is never reported as deliberate disablement.
      if (
        env.NODE_ENV !== "production" ||
        env.SAYBOARD_LOCAL_DEV
      )
        throw new Error("Invalid hosted runtime");
      const disabled = [undefined, "", "0"].includes(env.SAYBOARD_AUTH_ENABLED);
      if (!disabled) hostedConfig(env);
      return new Response(
        JSON.stringify({ state: disabled ? "disabled" : "enabled" }),
        { status: 200, headers },
      );
    } catch {
      return new Response('{"error":"auth_unconfigured"}', {
        status: 503,
        headers,
      });
    }
  };
}

