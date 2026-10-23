import { abortable } from "./async.js";
import { flagsLimits, FlagsError, type FlagsProvider } from "./contracts.js";
import { record } from "./validation.js";

export interface HttpFlagsProviderOptions {
  readonly endpoint: string;
  readonly headers?: HeadersInit | ((options: { readonly signal: AbortSignal }) => HeadersInit | Promise<HeadersInit>);
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

function validateEndpoint(value: string): string {
  let endpoint: URL;
  try { endpoint = new URL(value, "https://aside.invalid"); } catch { throw new FlagsError("INVALID_ENDPOINT"); }
  if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || value.startsWith("//") || (!/^https?:\/\//.test(value) && !value.startsWith("/"))) throw new FlagsError("INVALID_ENDPOINT");
  return value;
}

async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) throw new FlagsError("INVALID_RESPONSE");
  const reader = response.body?.getReader();
  if (!reader) throw new FlagsError("INVALID_RESPONSE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > flagsLimits.responseBytes) throw new FlagsError("RESPONSE_TOO_LARGE");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createHttpFlagsProvider(options: HttpFlagsProviderOptions): FlagsProvider {
  const endpoint = validateEndpoint(options.endpoint);
  const fetcher = options.fetch ?? fetch;
  const configuredHeaders = typeof options.headers === "function" ? options.headers : new Headers(options.headers);
  return async ({ signal }) => {
    if (signal.aborted) throw new FlagsError("REQUEST_ABORTED");
    const supplied = typeof configuredHeaders === "function" ? await abortable(Promise.resolve(configuredHeaders({ signal })), signal) : configuredHeaders;
    if (signal.aborted) throw new FlagsError("REQUEST_ABORTED");
    const headers = new Headers(supplied);
    headers.set("Accept", "application/json");
    const response = await abortable(fetcher(endpoint, { method: "GET", headers, credentials: "omit", redirect: "error", cache: "no-store", signal }), signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new FlagsError(response.status === 429 ? "RATE_LIMITED" : "REMOTE_UNAVAILABLE");
    }
    const value = await readBody(response, signal);
    if (!record(value) || !record(value.data)) throw new FlagsError("INVALID_RESPONSE");
    return value.data;
  };
}
