import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { MAX_BODY_BYTES } from "./api-http.js";

type Handler = (request: Request, peer: string) => Promise<Response>;
export function localServer(handler: Handler, origin?: string) {
  const server = createServer(
    async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      // After shutdown starts, close each keep-alive connection once its
      // response is sent rather than holding it for keepAliveTimeout.
      outgoing.once("finish", () => {
        if (!server.listening) server.closeIdleConnections();
      });
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const method = incoming.method ?? "GET";
        // Bounded memory even for chunked requests. Keep one extra byte so the API
        // can distinguish an oversized body from invalid JSON and return 413.
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of incoming) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const retained = bytes.subarray(
            0,
            Math.max(0, MAX_BODY_BYTES + 1 - size),
          );
          if (retained.length) chunks.push(retained);
          size += retained.length;
        }
        const request = new Request(
          new URL(
            incoming.url ?? "/",
            origin ?? `http://${incoming.headers.host ?? "invalid"}`,
          ),
          {
            method,
            headers,
            body:
              method === "GET" || method === "HEAD"
                ? undefined
                : Buffer.concat(chunks),
          },
        );
        const response = await handler(
          request,
          incoming.socket.remoteAddress ?? "",
        );
        outgoing.writeHead(response.status, {
          ...Object.fromEntries(response.headers),
          ...(response.headers.has("set-cookie")
            ? { "set-cookie": response.headers.getSetCookie() }
            : {}),
        });
        if (response.body) {
          const reader = response.body.getReader();
          outgoing.once("close", () => {
            void reader.cancel().catch(() => {});
          });
          try {
            while (!outgoing.destroyed) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!outgoing.write(value))
                await new Promise<void>((resolve) => {
                  const done = () => {
                    outgoing.off("drain", done);
                    outgoing.off("close", done);
                    resolve();
                  };
                  outgoing.once("drain", done);
                  outgoing.once("close", done);
                });
            }
          } finally {
            reader.releaseLock();
          }
        }
        outgoing.end();
      } catch {
        if (outgoing.headersSent) {
          outgoing.destroy();
          return;
        }
        outgoing.writeHead(400, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        outgoing.end('{"error":"invalid_request"}');
      }
    },
  );
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  // Outlast the reverse proxy's idle upstream connections (Caddy: 2 minutes) so
  // the proxy, not Node, closes them. Otherwise a request sent just as Node
  // closes an idle socket fails, and Caddy answers a POST or PUT with 502.
  // Idle sockets are not subject to headersTimeout or requestTimeout.
  server.keepAliveTimeout = 130_000;
  return server;
}
