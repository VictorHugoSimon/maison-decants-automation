import type { Env, OAuthTokenResponse } from "../types";

const MANDATORY_WEBHOOK_EVENTS = ["app/uninstalled", "app/suspended"] as const;

const DEFAULT_WEBHOOK_EVENTS = [
  ...MANDATORY_WEBHOOK_EVENTS,
  "order/created",
  "order/updated",
  "order/edited",
  "order/paid",
  "order/cancelled",
  "product/created",
  "product/updated",
  "product/deleted",
  "customer/created",
  "customer/updated",
  "customer/deleted",
] as const;

export interface WebhookRegistrationReport {
  registered: string[];
  existing: string[];
  failed: Array<{ event: string; error: string }>;
}

function userAgent(env: Env): string {
  return `${env.APP_NAME} (${env.APP_CONTACT_EMAIL})`;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function exchangeAuthorizationCode(
  env: Env,
  code: string,
): Promise<OAuthTokenResponse> {
  const response = await fetch(env.NUVEMSHOP_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent(env),
    },
    body: JSON.stringify({
      client_id: env.NUVEMSHOP_CLIENT_ID,
      client_secret: env.NUVEMSHOP_CLIENT_SECRET,
      redirect_uri: env.NUVEMSHOP_REDIRECT_URI,
      grant_type: "authorization_code",
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with HTTP ${response.status}`);
  }

  const token = (await response.json()) as OAuthTokenResponse;
  if (!token.access_token || !token.user_id) {
    throw new Error("OAuth token response is missing access_token or user_id");
  }

  return token;
}

export async function nuvemshopApi<T>(
  env: Env,
  storeId: number,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${env.NUVEMSHOP_API_BASE_URL}/${storeId}${path}`;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": userAgent(env),
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      if (response.status === 429 || response.status >= 500) {
        const resetHeader = response.headers.get("x-rate-limit-reset");
        const resetMs = resetHeader ? Number.parseInt(resetHeader, 10) : Number.NaN;
        const delay = Number.isFinite(resetMs)
          ? Math.max(250, resetMs)
          : Math.min(8_000, 500 * 2 ** attempt);
        await sleep(delay);
        continue;
      }

      const body = await response.text();
      throw new Error(`Nuvemshop API ${response.status}: ${body.slice(0, 500)}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 4) break;
      await sleep(Math.min(8_000, 500 * 2 ** attempt));
    }
  }

  throw lastError ?? new Error("Nuvemshop API request failed");
}

export async function registerCoreWebhooks(
  env: Env,
  storeId: number,
  accessToken: string,
  publicBaseUrl: string,
): Promise<WebhookRegistrationReport> {
  type Webhook = { id: number; event: string; url: string };
  const existing = await nuvemshopApi<Webhook[]>(env, storeId, accessToken, "/webhooks?per_page=200");
  const targetUrl = `${publicBaseUrl.replace(/\/$/, "")}/webhooks/nuvemshop`;
  const report: WebhookRegistrationReport = { registered: [], existing: [], failed: [] };

  for (const event of DEFAULT_WEBHOOK_EVENTS) {
    const alreadyRegistered = existing.some(
      (webhook) => webhook.event === event && webhook.url === targetUrl,
    );
    if (alreadyRegistered) {
      report.existing.push(event);
      continue;
    }

    try {
      await nuvemshopApi<Webhook>(env, storeId, accessToken, "/webhooks", {
        method: "POST",
        body: JSON.stringify({ event, url: targetUrl }),
      });
      report.registered.push(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failed.push({ event, error: message.slice(0, 500) });
    }
  }

  const mandatoryFailures = report.failed.filter((failure) =>
    (MANDATORY_WEBHOOK_EVENTS as readonly string[]).includes(failure.event),
  );
  if (mandatoryFailures.length > 0) {
    throw new Error(
      `Mandatory webhook registration failed: ${mandatoryFailures
        .map((failure) => `${failure.event}: ${failure.error}`)
        .join(" | ")}`,
    );
  }

  return report;
}
