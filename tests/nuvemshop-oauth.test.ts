import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeAuthorizationCode } from "../src/lib/nuvemshop";
import type { Env } from "../src/types";

const env = {
  APP_NAME: "Maison Decants Automacao (test)",
  APP_CONTACT_EMAIL: "victorhugoteixeirasimon@gmail.com",
  NUVEMSHOP_OAUTH_TOKEN_URL: "https://www.tiendanube.com/apps/authorize/token",
  NUVEMSHOP_CLIENT_ID: "123456",
  NUVEMSHOP_CLIENT_SECRET: "test-secret",
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exchangeAuthorizationCode", () => {
  it("sends the authorization code in the request body using form encoding", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "bearer",
          scope: "read_orders",
          user_id: 987654,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeAuthorizationCode(env, "fresh-code")).resolves.toMatchObject({
      access_token: "access-token",
      user_id: 987654,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.tiendanube.com/apps/authorize/token");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");

    const body = init.body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get("client_id")).toBe("123456");
    expect(body.get("client_secret")).toBe("test-secret");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("fresh-code");
    expect(body.has("redirect_uri")).toBe(false);
  });

  it("preserves a whitelisted OAuth error code without exposing the raw response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "do-not-expose-this-description",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeAuthorizationCode(env, "fresh-code")).rejects.toThrow(
      "OAuth token exchange failed with HTTP 401: invalid_client",
    );
  });

  it("does not expose unknown error details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "unexpected_provider_error",
          detail: "sensitive-provider-detail",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeAuthorizationCode(env, "fresh-code")).rejects.toThrow(
      "OAuth token exchange failed with HTTP 400",
    );
    await expect(exchangeAuthorizationCode(env, "fresh-code")).rejects.not.toThrow(
      "sensitive-provider-detail",
    );
  });
});
