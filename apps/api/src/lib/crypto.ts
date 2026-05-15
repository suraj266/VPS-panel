import { hash, verify } from "@node-rs/argon2";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { env } from "../env.js";

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(
  hashed: string,
  password: string,
): Promise<boolean> {
  return verify(hashed, password);
}

export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

function deriveKey(): Buffer {
  const raw = Buffer.from(env.PANEL_MASTER_KEY, "base64");
  if (raw.length === 32) return raw;
  return createHash("sha256").update(env.PANEL_MASTER_KEY).digest();
}

export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decrypt(payload: string): string {
  const key = deriveKey();
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("invalid ciphertext");
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
