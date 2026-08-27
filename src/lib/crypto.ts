const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plainText: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plainText),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(cipherText: string, secret: string): Promise<string> {
  const [ivPart, payloadPart] = cipherText.split(".");
  if (!ivPart || !payloadPart) throw new Error("Invalid encrypted secret format");

  const key = await deriveEncryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(payloadPart),
  );
  return decoder.decode(decrypted);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifyNuvemshopWebhook(
  rawBody: string,
  signatureHex: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHex) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return constantTimeEqual(expected.toLowerCase(), signatureHex.toLowerCase());
}
