export interface Env {
  DB: D1Database;
  APP_NAME: string;
  APP_CONTACT_EMAIL: string;
  NUVEMSHOP_API_BASE_URL: string;
  NUVEMSHOP_OAUTH_TOKEN_URL: string;
  NUVEMSHOP_CLIENT_ID: string;
  NUVEMSHOP_CLIENT_SECRET: string;
  NUVEMSHOP_REDIRECT_URI: string;
  TOKEN_ENCRYPTION_KEY: string;
  ADMIN_SESSION_SECRET: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  user_id: number;
}

export interface NuvemshopWebhookPayload {
  store_id: number;
  event: string;
  id?: number | string;
  order_id?: number | string;
  fulfillment_id?: string;
  [key: string]: unknown;
}
