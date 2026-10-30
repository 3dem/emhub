// src/data/DataLoader.ts
//
// Fetches data from the host backend for the components (VolumeViewer and
// others). It is the only place where emflow talks to a server: how a request
// is sent (url, payload wrapping, errors) is decided by the host through the
// options, so emflow keeps no host specific code.
//
// - load(path, payload): one request, cached by path + payload (LRU) and
//   shared while in flight, so several components asking for the same data
//   send a single request.
// - image(src): a decoded <img> for a url or a base64 PNG, cached the same way.

/** Sends one request; `path` is relative to the host API (or a full url). */
export type DataRequest = (
  path: string,
  payload: unknown,
  init: { signal?: AbortSignal },
) => Promise<unknown>;

export type DataLoaderOptions = {
  /** Host transport. If missing, `fetch` posts JSON to `baseUrl + path`. */
  request?: DataRequest;
  baseUrl?: string;
  /** Body sent by the default transport (default: the payload itself). */
  wrapPayload?: (payload: unknown) => unknown;
  /** Data returned to the caller; throw to report an error (default: the json). */
  unwrapResponse?: (json: any) => unknown;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** Cached responses and images (least recently used are dropped). */
  maxEntries?: number;
};

export type LoadOptions = {
  /** Cache key (default: path + JSON payload). */
  key?: string;
  /** false: always request, and do not keep the result. */
  cache?: boolean;
  signal?: AbortSignal;
};

const DEFAULT_MAX_ENTRIES = 200;

function abortError() {
  return new DOMException("The request was aborted", "AbortError");
}

/** Resolves like `promise`, but rejects as soon as `signal` aborts. */
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

export class DataLoader {
  private readonly options: DataLoaderOptions;
  private readonly maxEntries: number;
  // Insertion order is the LRU order: a hit is moved to the end
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(options: DataLoaderOptions = {}) {
    this.options = options;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Loader for EMhub's API: POST `{attrs: payload}` as JSON (as
   * send_ajax_json does) and fail with the `error` of the response.
   */
  static emhub(options: Omit<DataLoaderOptions, "wrapPayload" | "unwrapResponse"> = {}) {
    return new DataLoader({
      credentials: "same-origin",
      ...options,
      wrapPayload: (payload) => ({ attrs: payload ?? {} }),
      unwrapResponse: (json) => {
        if (json && typeof json === "object" && "error" in json && json.error) {
          throw new Error(String(json.error));
        }
        return json;
      },
    });
  }

  /** Data of one request (see LoadOptions for the cache). */
  load<T = unknown>(path: string, payload?: unknown, opts: LoadOptions = {}): Promise<T> {
    const useCache = opts.cache !== false;
    const key = opts.key ?? `${path}\u0000${JSON.stringify(payload ?? null)}`;
    if (useCache) {
      const hit = this.cache.get(key);
      if (hit) {
        this.touch(key, hit);
        return withSignal(hit as Promise<T>, opts.signal);
      }
    }
    // The shared request is not aborted by one caller: others may wait for it
    const promise = this.send(path, payload, useCache ? undefined : opts.signal);
    if (useCache) {
      this.remember(key, promise);
      // A failed request is not cached, so it can be tried again
      promise.catch(() => {
        if (this.cache.get(key) === promise) this.cache.delete(key);
      });
    }
    return withSignal(promise as Promise<T>, opts.signal);
  }

  /** A decoded image for a url, a data url or a base64 PNG (no prefix). */
  image(src: string): Promise<HTMLImageElement> {
    const url = /^(data:|blob:|https?:|\/)/.test(src) ? src : `data:image/png;base64,${src}`;
    // Long base64 strings are keyed by their length and ends
    const key = url.length > 256
      ? `img\u0000${url.length}\u0000${url.slice(0, 96)}\u0000${url.slice(-96)}`
      : `img\u0000${url}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.touch(key, hit);
      return hit as Promise<HTMLImageElement>;
    }
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load the image"));
      img.src = url;
    });
    this.remember(key, promise);
    promise.catch(() => this.cache.delete(key));
    return promise;
  }

  /** Drop cached entries whose key starts with `prefix` (all if omitted). */
  invalidate(prefix?: string) {
    if (prefix === undefined) {
      this.cache.clear();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  private send(path: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const { request, unwrapResponse } = this.options;
    const sent = request ? request(path, payload, { signal }) : this.fetchJson(path, payload, signal);
    return Promise.resolve(sent).then((json) => (unwrapResponse ? unwrapResponse(json) : json));
  }

  private async fetchJson(path: string, payload: unknown, signal?: AbortSignal) {
    const { baseUrl = "", wrapPayload, headers, credentials } = this.options;
    const url = /^https?:|^\//.test(path) || !baseUrl ? path : `${baseUrl.replace(/\/$/, "")}/${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
      body: JSON.stringify(wrapPayload ? wrapPayload(payload) : payload ?? {}),
      credentials,
      signal,
    });
    if (!res.ok) throw new Error(`Request failed (${res.status}): ${path}`);
    return res.json();
  }

  private touch(key: string, value: Promise<unknown>) {
    this.cache.delete(key);
    this.cache.set(key, value);
  }

  private remember(key: string, value: Promise<unknown>) {
    this.cache.set(key, value);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

/** A DataLoader from a loader or its options (shared default without either). */
let defaultLoader: DataLoader | null = null;
export function toDataLoader(value?: DataLoader | DataLoaderOptions | null): DataLoader {
  if (value instanceof DataLoader) return value;
  if (value) return new DataLoader(value);
  return (defaultLoader ??= new DataLoader());
}
