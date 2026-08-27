import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, verifyNuvemshopWebhook } from "../src/lib/crypto";

const encoder = new TextEncoder();

async function hmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("crypto helpers", () => {
  it("encrypts and decrypts a stored access token", async () => {
    const secret = "test-encryption-key-with-enough-entropy";
    const encrypted = await encryptSecret("access-token-123", secret);
    expect(encrypted).not.toContain("access-token-123");
    await expect(decryptSecret(encrypted, secret)).resolves.toBe("access-token-123");
  });

  it("validates the Nuvemshop webhook HMAC", async () => {
    const body = JSON.stringify({ store_id: 123, event: "product/created", id: 456 });
    const secret = "app-secret";
    const signature = await hmacHex(body, secret);

    await expect(verifyNuvemshopWebhook(body, signature, secret)).resolves.toBe(true);
    await expect(verifyNuvemshopWebhook(`${body}x`, signature, secret)).resolves.toBe(false);
  });
});
