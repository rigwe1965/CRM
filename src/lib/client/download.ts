import { ApiClientError } from "./api";

/**
 * Downloads a file from the API and saves it with the name the server chose. Uses fetch (not a plain
 * link) so a refusal arrives as a readable message instead of a page of raw JSON. Resolves to the file
 * name, or throws ApiClientError.
 */
export async function downloadFile(method: "GET" | "POST", path: string, body?: unknown): Promise<string> {
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
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    }
    const json = await res.json().catch(() => ({}));
    throw new ApiClientError(res.status, json.error ?? "The export failed. Please try again.", json.code ?? "ERROR", json.fieldErrors ?? {});
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "export";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the save before the temporary address goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
