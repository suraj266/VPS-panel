import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateWebhookSecret(): string {
  // 32 bytes -> 64 hex chars. Easy to paste into GitHub UI.
  return randomBytes(32).toString("hex");
}

/**
 * Verify GitHub-style `X-Hub-Signature-256: sha256=<hex>` against raw body.
 * Uses constant-time comparison.
 */
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(expected, "hex"),
  );
}

/**
 * GitLab uses a plain token in `X-Gitlab-Token` header (no HMAC).
 * Constant-time compare to avoid timing attacks.
 */
export function verifyGitlabToken(
  tokenHeader: string | undefined,
  secret: string,
): boolean {
  if (!tokenHeader) return false;
  const a = Buffer.from(tokenHeader);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface GithubPushPayload {
  ref: string; // e.g. "refs/heads/main"
  after?: string; // commit sha
  head_commit?: { message?: string };
}

export interface GitlabPushPayload {
  ref: string;
  checkout_sha?: string;
  commits?: Array<{ message?: string }>;
}

export interface PushEvent {
  branch: string;
  sha: string | undefined;
  commitMessage: string | undefined;
}

export function parsePushEvent(
  payload: unknown,
): PushEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const ref = typeof p.ref === "string" ? p.ref : null;
  if (!ref || !ref.startsWith("refs/heads/")) return null;
  const branch = ref.replace("refs/heads/", "");

  // GitHub-style
  if (typeof p.after === "string" || p.head_commit) {
    const gh = p as unknown as GithubPushPayload;
    return {
      branch,
      sha: gh.after,
      commitMessage: gh.head_commit?.message,
    };
  }

  // GitLab-style
  const gl = p as unknown as GitlabPushPayload;
  return {
    branch,
    sha: gl.checkout_sha,
    commitMessage: gl.commits?.[0]?.message,
  };
}
