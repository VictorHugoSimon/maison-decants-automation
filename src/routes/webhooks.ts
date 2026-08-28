import { decryptSecret, verifyNuvemshopWebhook } from "../lib/crypto";
import { nuvemshopApi } from "../lib/nuvemshop";
import type { Env, NuvemshopWebhookPayload, QueuedWebhookMessage } from "../types";

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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
  status: "queued" | "processing" | "processed" | "error",
  errorMessage?: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE webhook_events
     SET processing_status = ?,
         processed_at = CASE WHEN ? = 'processed' THEN CURRENT_TIMESTAMP ELSE processed_at END,
         error_message = ?
     WHERE event_id = ?`,
  )
    .bind(status, status, errorMessage ?? null, eventId)
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

async function executeWebhook(
  env: Env,
  eventId: string,
  payload: NuvemshopWebhookPayload,
): Promise<void> {
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
}

async function claimEvent(env: Env, eventId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE webhook_events
     SET processing_status = 'processing', error_message = NULL
     WHERE event_id = ? AND processing_status IN ('received', 'queued', 'error')`,
  )
    .bind(eventId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function handleWebhookQueue(
  batch: MessageBatch<QueuedWebhookMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const { eventId, payload } = message.body;
    const claimed = await claimEvent(env, eventId);
    if (!claimed) {
      message.ack();
      continue;
    }

    try {
      await executeWebhook(env, eventId, payload);
      message.ack();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(
        "INSERT INTO audit_log (store_id, action, status, details) VALUES (?, ?, 'error', ?)",
      )
        .bind(payload.store_id, `webhook:${payload.event}`, detail.slice(0, 1000))
        .run();
      await markEvent(env, eventId, "error", detail.slice(0, 1000));
      message.retry();
    }
  }
}

export async function handleNuvemshopWebhook(request: Request, env: Env): Promise<Response> {
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
  const eventId = await sha256Hex(rawBody);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (event_id, store_id, event_name, entity_id, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(eventId, payload.store_id, payload.event, payload.id === undefined ? null : String(payload.id), rawBody)
    .run();

  const existing = await env.DB.prepare(
    "SELECT processing_status FROM webhook_events WHERE event_id = ?",
  )
    .bind(eventId)
    .first<{ processing_status: string }>();

  if (existing?.processing_status === "processed") {
    return new Response("ok", { status: 200 });
  }

  await env.WEBHOOK_QUEUE.send({ eventId, payload });
  await markEvent(env, eventId, "queued");
  return new Response("ok", { status: 200 });
}
