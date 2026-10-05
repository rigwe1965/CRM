export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(params: Query = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Calls the REST API. Resolves to the parsed JSON body (undefined for 204) or throws ApiClientError. */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError(0, "Network error. Check your connection and try again.", "NETWORK");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiClientError(
      res.status,
      json.error ?? "Something went wrong. Please try again.",
      json.code ?? "ERROR",
      json.fieldErrors ?? {},
    );
  }
  return json as T;
}
