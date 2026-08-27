import { decryptSecret, verifyNuvemshopWebhook } from "../lib/crypto";
import { nuvemshopApi } from "../lib/nuvemshop";
import type { Env, NuvemshopWebhookPayload } from "../types";

async function ensureStore(env: Env, storeId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO stores (store_id, status, installed_at, updated_at)
     VALUES (?, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(store_id) DO NOTHING`,
  )
    .bind(storeId)
    .run();
}

async function markEvent(
  env: Env,
  eventId: string,
  status: "processed" | "error",
  errorMessage?: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE webhook_events
     SET processing_status = ?, processed_at = CURRENT_TIMESTAMP, error_message = ?
     WHERE event_id = ?`,
  )
    .bind(status, errorMessage ?? null, eventId)
    .run();
}

async function upsertSnapshot(
  env: Env,
  storeId: number,
  entityType: string,
  entityId: string,
  payload: unknown,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity_snapshots (store_id, entity_type, entity_id, payload_json, synced_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(store_id, entity_type, entity_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       synced_at = CURRENT_TIMESTAMP`,
  )
    .bind(storeId, entityType, entityId, JSON.stringify(payload))
    .run();
}

async function processEntityEvent(
  env: Env,
  payload: NuvemshopWebhookPayload,
): Promise<void> {
  const [resource, action] = payload.event.split("/");
  if (!resource || !action || payload.id === undefined) return;

  const supported: Record<string, { path: string; entityType: string }> = {
    order: { path: "orders", entityType: "order" },
    product: { path: "products", entityType: "product" },
    customer: { path: "customers", entityType: "customer" },
  };
  const config = supported[resource];
  if (!config) return;

  const entityId = String(payload.id);
  if (action === "deleted") {
    await env.DB.prepare(
      "DELETE FROM entity_snapshots WHERE store_id = ? AND entity_type = ? AND entity_id = ?",
    )
      .bind(payload.store_id, config.entityType, entityId)
      .run();
    return;
  }

  const row = await env.DB.prepare(
    "SELECT access_token_ciphertext FROM stores WHERE store_id = ?",
  )
    .bind(payload.store_id)
    .first<{ access_token_ciphertext: string | null }>();
  if (!row?.access_token_ciphertext) throw new Error("Store access token is unavailable");

  const accessToken = await decryptSecret(row.access_token_ciphertext, env.TOKEN_ENCRYPTION_KEY);
  const entity = await nuvemshopApi<unknown>(
    env,
    payload.store_id,
    accessToken,
    `/${config.path}/${encodeURIComponent(entityId)}`,
  );
  await upsertSnapshot(env, payload.store_id, config.entityType, entityId, entity);
}

async function processWebhook(
  env: Env,
  eventId: string,
  payload: NuvemshopWebhookPayload,
): Promise<void> {
  try {
    if (payload.event === "app/uninstalled") {
      await env.DB.prepare(
        `UPDATE stores SET status = 'uninstalled', access_token_ciphertext = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE store_id = ?`,
      )
        .bind(payload.store_id)
        .run();
    } else if (payload.event === "app/suspended") {
      await env.DB.prepare(
        "UPDATE stores SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE store_id = ?",
      )
        .bind(payload.store_id)
        .run();
    } else if (payload.event === "app/resumed") {
      await env.DB.prepare(
        "UPDATE stores SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE store_id = ?",
      )
        .bind(payload.store_id)
        .run();
    } else {
      await processEntityEvent(env, payload);
    }

    await env.DB.prepare(
      "INSERT INTO audit_log (store_id, action, status, details) VALUES (?, ?, 'success', ?)",
    )
      .bind(payload.store_id, `webhook:${payload.event}`, JSON.stringify({ event_id: eventId }))
      .run();
    await markEvent(env, eventId, "processed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "INSERT INTO audit_log (store_id, action, status, details) VALUES (?, ?, 'error', ?)",
    )
      .bind(payload.store_id, `webhook:${payload.event}`, message.slice(0, 1000))
      .run();
    await markEvent(env, eventId, "error", message.slice(0, 1000));
  }
}

export async function handleNuvemshopWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-linkedstore-hmac-sha256");
  const isValid = await verifyNuvemshopWebhook(rawBody, signature, env.NUVEMSHOP_CLIENT_SECRET);
  if (!isValid) return new Response("invalid signature", { status: 401 });

  let payload: NuvemshopWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as NuvemshopWebhookPayload;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (!Number.isInteger(payload.store_id) || !payload.event) {
    return new Response("invalid payload", { status: 400 });
  }

  await ensureStore(env, payload.store_id);
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO webhook_events (event_id, store_id, event_name, entity_id, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(eventId, payload.store_id, payload.event, payload.id === undefined ? null : String(payload.id), rawBody)
    .run();

  ctx.waitUntil(processWebhook(env, eventId, payload));
  return new Response("accepted", { status: 202 });
}
