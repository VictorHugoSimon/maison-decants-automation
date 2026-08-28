import { handleOAuthCallback, handleOAuthInstall } from "./routes/oauth";
import { handleNuvemshopWebhook, handleWebhookQueue } from "./routes/webhooks";
import type { Env, QueuedWebhookMessage } from "./types";

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({
      ok: true,
      service: "maison-decants-automation",
      timestamp: new Date().toISOString(),
    });
  }

  if (request.method === "GET" && url.pathname === "/oauth/install") {
    return handleOAuthInstall(env);
  }

  if (request.method === "GET" && url.pathname === "/oauth/callback") {
    return handleOAuthCallback(request, env);
  }

  if (request.method === "POST" && url.pathname === "/webhooks/nuvemshop") {
    return handleNuvemshopWebhook(request, env);
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withSecurityHeaders(await route(request, env));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Unhandled error", message);
      return withSecurityHeaders(Response.json({ error: "internal_error" }, { status: 500 }));
    }
  },

  async queue(batch: MessageBatch<QueuedWebhookMessage>, env: Env): Promise<void> {
    await handleWebhookQueue(batch, env);
  },
};
