import crypto from "node:crypto";

let cachedKey = null;

function key() {
  if (!cachedKey) {
    cachedKey = crypto.createHash("sha256").update(String(process.env.JWT_SECRET || "dev-secret")).digest();
  }
  return cachedKey;
}

export function encryptSecret(plain) {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload) {
  if (!payload) return "";
  try {
    const buffer = Buffer.from(payload, "base64");
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const data = buffer.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
