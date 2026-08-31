import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const swPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/sw.js");

function loadServiceWorker(fetchImpl: typeof fetch, cachesImpl: CacheStorage) {
  const listeners = new Map<string, (event: { request: Request; respondWith: (p: Promise<Response>) => void }) => void>();
  const sandbox = {
    self: {
      addEventListener(type: string, handler: (event: unknown) => void) {
        listeners.set(type, handler as never);
      },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: cachesImpl,
    fetch: fetchImpl,
    Response,
    URL,
    console,
  };
  vm.runInNewContext(readFileSync(swPath, "utf8"), sandbox, { filename: "sw.js" });
  return listeners;
}

describe("service worker API caching", () => {
  it("does not read or write Cache Storage for successful GET /api", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const put = vi.fn();
    const match = vi.fn();
    const cachesImpl = {
      open: vi.fn(async () => ({ put, match, keys: async () => [] })),
      match,
      keys: vi.fn(async () => []),
      delete: vi.fn(),
      has: vi.fn(),
    } as unknown as CacheStorage;

    const listeners = loadServiceWorker(fetchImpl as unknown as typeof fetch, cachesImpl);
    const fetchHandler = listeners.get("fetch");
    expect(fetchHandler).toBeTypeOf("function");

    let responded: Promise<Response> | undefined;
    fetchHandler!({
      request: new Request("http://127.0.0.1:5173/api/chat/conversations"),
      respondWith(p) {
        responded = p;
      },
    });
    const res = await responded;
    expect(res?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
    expect(cachesImpl.open).not.toHaveBeenCalled();
  });

  it("does not fall back to Cache Storage when GET /api is offline", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const match = vi.fn();
    const put = vi.fn();
    const cachesImpl = {
      open: vi.fn(async () => ({ put, match, keys: async () => [] })),
      match,
      keys: vi.fn(async () => []),
      delete: vi.fn(),
      has: vi.fn(),
    } as unknown as CacheStorage;

    const listeners = loadServiceWorker(fetchImpl as unknown as typeof fetch, cachesImpl);
    const fetchHandler = listeners.get("fetch");
    let responded: Promise<Response> | undefined;
    fetchHandler!({
      request: new Request("http://127.0.0.1:5173/api/system/health"),
      respondWith(p) {
        responded = p;
      },
    });
    await expect(responded).rejects.toThrow("Failed to fetch");
    expect(match).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
