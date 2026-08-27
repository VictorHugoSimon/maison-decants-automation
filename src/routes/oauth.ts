import { encryptSecret } from "../lib/crypto";
import { exchangeAuthorizationCode, registerCoreWebhooks } from "../lib/nuvemshop";
import type { Env } from "../types";

function html(message: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maison Decants Automação</title></head><body><main><h1>Maison Decants Automação</h1><p>${message}</p></main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function handleOAuthInstall(env: Env): Response {
  if (!env.NUVEMSHOP_CLIENT_ID) {
    return html("Aplicativo ainda não possui App ID configurado.", 503);
  }
  const authorizationUrl = `https://www.tiendanube.com/apps/${encodeURIComponent(env.NUVEMSHOP_CLIENT_ID)}/authorize`;
  return Response.redirect(authorizationUrl, 302);
}

export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return html("Código de autorização não recebido.", 400);

  try {
    const token = await exchangeAuthorizationCode(env, code);
    const encryptedToken = await encryptSecret(token.access_token, env.TOKEN_ENCRYPTION_KEY);

    await env.DB.prepare(
      `INSERT INTO stores (store_id, access_token_ciphertext, scopes, status, installed_at, updated_at)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(store_id) DO UPDATE SET
         access_token_ciphertext = excluded.access_token_ciphertext,
         scopes = excluded.scopes,
         status = 'active',
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(token.user_id, encryptedToken, token.scope ?? null)
      .run();

    await env.DB.prepare(
      "INSERT INTO audit_log (store_id, action, status, details) VALUES (?, 'oauth_install', 'success', ?)",
    )
      .bind(token.user_id, JSON.stringify({ scope: token.scope ?? null }))
      .run();

    const publicBaseUrl = new URL(env.NUVEMSHOP_REDIRECT_URI).origin;
    await registerCoreWebhooks(env, token.user_id, token.access_token, publicBaseUrl);

    return html("Integração autorizada com sucesso. A loja está conectada e os webhooks principais foram registrados.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "INSERT INTO audit_log (action, status, details) VALUES ('oauth_install', 'error', ?)",
    )
      .bind(message.slice(0, 1000))
      .run();
    return html("Não foi possível concluir a autorização. Consulte os logs técnicos antes de tentar novamente.", 502);
  }
}
