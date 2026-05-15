const BASE = "/api";

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body != null && !("content-type" in headers)) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
