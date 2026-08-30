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

  let stage = "token_exchange";

  try {
    const token = await exchangeAuthorizationCode(env, code);

    stage = "token_encryption";
    const encryptedToken = await encryptSecret(token.access_token, env.TOKEN_ENCRYPTION_KEY);

    stage = "store_persistence";
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

    stage = "oauth_audit";
    await env.DB.prepare(
      "INSERT INTO audit_log (store_id, action, status, details) VALUES (?, 'oauth_install', 'success', ?)",
    )
      .bind(token.user_id, JSON.stringify({ scope: token.scope ?? null }))
      .run();

    stage = "webhook_registration";
    const publicBaseUrl = new URL(env.NUVEMSHOP_REDIRECT_URI).origin;
    const webhookReport = await registerCoreWebhooks(
      env,
      token.user_id,
      token.access_token,
      publicBaseUrl,
    );

    stage = "webhook_audit";
    await env.DB.prepare(
      "INSERT INTO audit_log (store_id, action, status, details) VALUES (?, 'webhook_registration', ?, ?)",
    )
      .bind(
        token.user_id,
        webhookReport.failed.length === 0 ? "success" : "warning",
        JSON.stringify(webhookReport).slice(0, 4000),
      )
      .run();

    const optionalWarning = webhookReport.failed.length > 0
      ? ` ${webhookReport.failed.length} webhook(s) opcional(is) não foram registrados e ficaram documentados na auditoria.`
      : "";

    return html(`Integração autorizada com sucesso. A loja está conectada e os webhooks obrigatórios foram registrados.${optionalWarning}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("OAuth callback failed", { stage, message });

    try {
      await env.DB.prepare(
        "INSERT INTO audit_log (action, status, details) VALUES ('oauth_install', 'error', ?)",
      )
        .bind(JSON.stringify({ stage, message: message.slice(0, 500) }))
        .run();
    } catch (auditError) {
      const auditMessage = auditError instanceof Error ? auditError.message : String(auditError);
      console.error("OAuth failure audit write failed", { stage, message: auditMessage });
    }

    const knownOAuthErrors = [
      "invalid_client",
      "invalid_grant",
      "invalid_request",
      "unsupported_grant_type",
    ];
    const safeOAuthError = stage === "token_exchange"
      ? knownOAuthErrors.find((errorCode) => message.includes(errorCode))
      : undefined;
    const safeErrorSuffix = safeOAuthError ? ` Código seguro: ${safeOAuthError}.` : "";

    return html(`Não foi possível concluir a autorização. Etapa técnica: ${stage}.${safeErrorSuffix}`, 502);
  }
}
