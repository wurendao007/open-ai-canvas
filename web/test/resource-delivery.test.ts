import { describe, expect, test } from "bun:test";

import { clearResourceClientCaches, getResourceBlob, getResourceDirectUrl, getResourceStorageMode, isResourceUrl, resourceDownloadUrl, resourceDownloadUrlFromUrl, resourceFallbackUrl, resourceIdFromFileUrl, startResourceDownload } from "../src/services/api/resources";
import { apiClient } from "../src/services/api/request";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

describe("resource Blob delivery", () => {
    test("uses an attachment-preserving resource URL for explicit downloads", () => {
        expect(resourceDownloadUrl("download-resource")).toBe("/api/resources/download-resource/file?download=1");
        expect(resourceDownloadUrlFromUrl("/api/resources/download-resource/file")).toBe("/api/resources/download-resource/file?download=1");
        expect(resourceDownloadUrlFromUrl("https://storage.example/object.jpg", "resource:download-resource")).toBe("/api/resources/download-resource/file?download=1");
    });

    test("does not turn a failed direct lookup back into a same-origin resource file URL", () => {
        expect(resourceFallbackUrl("resource-id", "/api/resources/resource-id/file")).toBe("");
        expect(resourceFallbackUrl("resource-id", "https://cdn.example/image.jpg")).toBe("https://cdn.example/image.jpg");
    });

    test("reuses a short-lived signed URL across repeated media consumers", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        let apiCalls = 0;
        apiClient.defaults.adapter = async (config) => {
            apiCalls += 1;
            expect(config.url).toBe("/resources/direct-cache/direct-url");
            return {
                data: { code: 0, data: { url: "https://storage.example/cached.jpg?signature=short-lived" }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        };
        try {
            await expect(getResourceDirectUrl("resource:direct-cache")).resolves.toContain("cached.jpg");
            await expect(getResourceDirectUrl("resource:direct-cache")).resolves.toContain("cached.jpg");
            expect(apiCalls).toBe(1);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
        }
    });

    test("keeps local resources on the authenticated file route", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "", proxy: true }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        try {
            await expect(getResourceDirectUrl("resource:local-resource")).resolves.toBe("/api/resources/local-resource/file");
        } finally {
            apiClient.defaults.adapter = previousAdapter;
        }
    });

    test("force refreshes an expired provider URL without changing the resource identity", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        let apiCalls = 0;
        apiClient.defaults.adapter = async (config) => {
            apiCalls += 1;
            return {
                data: { code: 0, data: { url: `https://storage.example/refresh-${apiCalls}.jpg?signature=short-lived` }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        };
        try {
            await expect(getResourceDirectUrl("resource:direct-refresh")).resolves.toContain("refresh-1");
            await expect(getResourceDirectUrl("resource:direct-refresh", { forceRefresh: true })).resolves.toContain("refresh-2");
            expect(apiCalls).toBe(2);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
        }
    });

    test("keeps the newest forced refresh authoritative when signed URL requests finish out of order", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const first = deferred<string>();
        const refreshed = deferred<string>();
        let apiCalls = 0;
        apiClient.defaults.adapter = async (config) => {
            apiCalls += 1;
            const url = await (apiCalls === 1 ? first.promise : refreshed.promise);
            return {
                data: { code: 0, data: { url }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        };
        try {
            const originalRequest = getResourceDirectUrl("resource:direct-refresh-race");
            const forcedRequest = getResourceDirectUrl("resource:direct-refresh-race", { forceRefresh: true });
            first.resolve("https://storage.example/stale.jpg?signature=old");
            await expect(originalRequest).resolves.toContain("signature=old");

            const joinedRequest = getResourceDirectUrl("resource:direct-refresh-race");
            expect(apiCalls).toBe(2);
            refreshed.resolve("https://storage.example/current.jpg?signature=new");
            await expect(forcedRequest).resolves.toContain("signature=new");
            await expect(joinedRequest).resolves.toContain("signature=new");
            await expect(getResourceDirectUrl("resource:direct-refresh-race")).resolves.toContain("signature=new");
            expect(apiCalls).toBe(2);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
        }
    });

    test("does not reuse a signed URL reverse index after the active user changes", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousWindow = globalThis.window;
        const previousScope = getActiveUserScope();
        const values = new Map<string, string>();
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                location: { origin: "http://canvas.local" },
                localStorage: {
                    getItem: (key: string) => values.get(key) ?? null,
                    setItem: (key: string, value: string) => values.set(key, value),
                },
            },
        });
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "https://storage.example/account-a.jpg?signature=private" }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        try {
            setActiveUserScope("account-a");
            const signedURL = await getResourceDirectUrl("resource:account-scoped-direct-url");
            expect(resourceDownloadUrlFromUrl(signedURL)).toContain("/resources/account-scoped-direct-url/file?download=1");

            setActiveUserScope("account-b");
            expect(resourceDownloadUrlFromUrl(signedURL)).toBe(signedURL);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
            if (previousWindow) setActiveUserScope(previousScope);
        }
    });

    test("does not cache a delayed OSS setting response under a different user", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousWindow = globalThis.window;
        const previousScope = getActiveUserScope();
        const values = new Map<string, string>();
        const accountA = deferred<void>();
        let apiCalls = 0;
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                location: { origin: "http://canvas.local" },
                localStorage: {
                    getItem: (key: string) => values.get(key) ?? null,
                    setItem: (key: string, value: string) => values.set(key, value),
                },
            },
        });
        apiClient.defaults.adapter = async (config) => {
            apiCalls += 1;
            if (apiCalls === 1) await accountA.promise;
            return {
                data: { code: 0, data: { setting: { storageMode: apiCalls === 1 ? "local" : "oss" } }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        };
        try {
            setActiveUserScope("storage-mode-account-a");
            const pendingA = getResourceStorageMode();
            setActiveUserScope("storage-mode-account-b");
            accountA.resolve();
            await expect(pendingA).resolves.toBe("local");
            await expect(getResourceStorageMode()).resolves.toBe("oss");
            expect(apiCalls).toBe(2);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
            if (previousWindow) setActiveUserScope(previousScope);
        }
    });

    test("rejects a signed URL that finishes after the active account changes", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousWindow = globalThis.window;
        const previousScope = getActiveUserScope();
        const values = new Map<string, string>();
        const delayed = deferred<string>();
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                location: { origin: "http://canvas.local" },
                localStorage: {
                    getItem: (key: string) => values.get(key) ?? null,
                    setItem: (key: string, value: string) => values.set(key, value),
                },
            },
        });
        apiClient.defaults.adapter = async (config) => {
            const url = await delayed.promise;
            return { data: { code: 0, data: { url }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        };
        try {
            setActiveUserScope("resource-race-account-a");
            const pending = getResourceDirectUrl("resource:resource-race");
            setActiveUserScope("resource-race-account-b");
            clearResourceClientCaches();
            delayed.resolve("https://storage.example/stale-after-switch.jpg?signature=old");
            await expect(pending).rejects.toThrow("资源账号已切换");
            expect(resourceDownloadUrlFromUrl("https://storage.example/stale-after-switch.jpg?signature=old")).toBe("https://storage.example/stale-after-switch.jpg?signature=old");
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
            if (previousWindow) setActiveUserScope(previousScope);
        }
    });

    test("recognizes legacy API file URLs without accepting unrelated third-party paths", () => {
        expect(resourceIdFromFileUrl("/api/resources/legacy-poster/file")).toBe("legacy-poster");
        expect(resourceIdFromFileUrl("http://canvas.local/api/resources/legacy-poster/file?download=1")).toBe("legacy-poster");
        expect(resourceIdFromFileUrl("https://storage.example/api/resources/legacy-poster/file")).toBe("");
        expect(isResourceUrl("/api/resources/legacy-poster/file")).toBe(true);
        expect(isResourceUrl("/api/resources/legacy-poster/file?download=1")).toBe(true);
        expect(isResourceUrl("https://storage.example/api/resources/legacy-poster/file")).toBe(false);
    });

    test("authorizes through the API and downloads the object directly without credentials", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousFetch = globalThis.fetch;
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        apiClient.defaults.adapter = async (config) => {
            expect(config.url).toBe("/resources/direct-object/direct-url");
            return {
                data: { code: 0, data: { url: "https://storage.example/object.jpg?signature=short-lived" }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        };
        globalThis.fetch = (async (input, init) => {
            requests.push({ url: String(input), init });
            return new Response("direct-body", { status: 200, headers: { "content-type": "image/jpeg" } });
        }) as typeof fetch;

        try {
            const blob = await getResourceBlob("resource:direct-object");

            expect(await blob?.text()).toBe("direct-body");
            expect(requests).toHaveLength(1);
            expect(requests[0]).toEqual({
                url: "https://storage.example/object.jpg?signature=short-lived",
                init: { credentials: "omit", cache: "force-cache" },
            });
        expect(resourceDownloadUrlFromUrl(requests[0].url)).toBe("/api/resources/direct-object/file?download=1");
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
        }
    });

    test("includes the session when Blob caching reads a local resource", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousFetch = globalThis.fetch;
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "", proxy: true }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        globalThis.fetch = (async (input, init) => {
            requests.push({ url: String(input), init });
            return new Response("local-body", { status: 200, headers: { "content-type": "image/jpeg" } });
        }) as typeof fetch;
        try {
            const blob = await getResourceBlob("resource:local-blob");
            expect(await blob?.text()).toBe("local-body");
            expect(requests).toEqual([
                {
                    url: "/api/resources/local-blob/file",
                    init: { credentials: "include", cache: "force-cache" },
                },
            ]);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
        }
    });

    test("uses an authenticated one-time proxy when provider CORS blocks Blob reads", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousFetch = globalThis.fetch;
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "https://storage.example/private.jpg?signature=short-lived" }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        globalThis.fetch = (async (input, init) => {
            const url = String(input);
            requests.push({ url, init });
            if (url.startsWith("https://storage.example/")) throw new TypeError("CORS blocked");
            return new Response("proxy-body", { status: 200, headers: { "content-type": "image/jpeg" } });
        }) as typeof fetch;

        try {
            const blob = await getResourceBlob("resource:cors-fallback");

            expect(await blob?.text()).toBe("proxy-body");
            expect(requests).toHaveLength(2);
            expect(requests[1]).toEqual({
                url: "/api/resources/cors-fallback/file?proxy=1",
                init: { credentials: "include" },
            });
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
        }
    });

    test("drops a proxy Blob that finishes after the active account changes", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousFetch = globalThis.fetch;
        const previousWindow = globalThis.window;
        const previousScope = getActiveUserScope();
        const values = new Map<string, string>();
        const delayed = deferred<Response>();
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                location: { origin: "http://canvas.local" },
                localStorage: {
                    getItem: (key: string) => values.get(key) ?? null,
                    setItem: (key: string, value: string) => values.set(key, value),
                },
            },
        });
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "https://storage.example/proxy-race.jpg?signature=short-lived" }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        globalThis.fetch = (async (input) => {
            if (String(input).startsWith("https://storage.example/")) throw new TypeError("CORS blocked");
            return delayed.promise;
        }) as typeof fetch;
        try {
            setActiveUserScope("proxy-race-account-a");
            const pending = getResourceBlob("resource:proxy-race", { proxyFallback: true });
            setActiveUserScope("proxy-race-account-b");
            clearResourceClientCaches();
            delayed.resolve(new Response("stale-proxy-body", { status: 200, headers: { "content-type": "image/jpeg" } }));
            await expect(pending).resolves.toBeNull();
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
            Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
            if (previousWindow) setActiveUserScope(previousScope);
        }
    });

    test("does not proxy when the direct Blob request is cancelled", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousFetch = globalThis.fetch;
        const requests: string[] = [];
        const controller = new AbortController();
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "https://storage.example/cancelled.jpg?signature=short-lived" }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        globalThis.fetch = (async (input) => {
            requests.push(String(input));
            throw new DOMException("The operation was aborted", "AbortError");
        }) as typeof fetch;

        try {
            await expect(getResourceBlob("resource:cancelled", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
            expect(requests).toEqual(["https://storage.example/cancelled.jpg?signature=short-lived"]);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
        }
    });

    test("does not proxy when the caller explicitly requires direct storage delivery", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousFetch = globalThis.fetch;
        const requests: string[] = [];
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "https://storage.example/direct-only.jpg?signature=short-lived" }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        globalThis.fetch = (async (input) => {
            requests.push(String(input));
            throw new TypeError("CORS blocked");
        }) as typeof fetch;

        try {
            await expect(getResourceBlob("resource:direct-only", { proxyFallback: false })).resolves.toBeNull();
            expect(requests).toEqual(["https://storage.example/direct-only.jpg?signature=short-lived"]);
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
        }
    });
});

describe("resource download authorization", () => {
    test("fetches a signed provider object as Blob before starting the browser download", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousDocument = globalThis.document;
        const previousFetch = globalThis.fetch;
        const previousCreateObjectURL = URL.createObjectURL;
        const previousRevokeObjectURL = URL.revokeObjectURL;
        let clickedHref = "";
        let clickedDownload = "";
        let fetched: { input: string; credentials?: RequestCredentials } | undefined;
        let revoked = "";
        const anchor = {
            href: "",
            rel: "",
            download: "",
            style: { display: "" },
            click() {
                clickedHref = this.href;
                clickedDownload = this.download;
            },
            remove() {},
        };
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                createElement: () => anchor,
                body: { appendChild() {} },
            },
        });
        apiClient.defaults.adapter = async (config) => {
            expect(config.url).toBe("/resources/download-direct/direct-url");
            expect(config.params).toEqual({ download: 1 });
            return {
                data: { code: 0, data: { url: "https://storage.example/object.jpg?response-content-disposition=attachment%3B%20filename%3Dobject.jpg" }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        };
        globalThis.fetch = (async (input, init) => {
            fetched = { input: String(input), credentials: init?.credentials };
            return new Response("image-bytes", { status: 200, headers: { "Content-Type": "image/jpeg" } });
        }) as typeof fetch;
        URL.createObjectURL = (() => "blob:download-direct") as typeof URL.createObjectURL;
        URL.revokeObjectURL = ((value) => {
            revoked = value;
        }) as typeof URL.revokeObjectURL;
        try {
            await startResourceDownload(resourceDownloadUrl("download-direct"), "fallback.jpg");
            expect(fetched).toEqual({
                input: "https://storage.example/object.jpg?response-content-disposition=attachment%3B%20filename%3Dobject.jpg",
                credentials: "omit",
            });
            expect(clickedHref).toBe("blob:download-direct");
            expect(clickedDownload).toBe("fallback.jpg");
            expect(revoked).toBe("blob:download-direct");
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
            URL.createObjectURL = previousCreateObjectURL;
            URL.revokeObjectURL = previousRevokeObjectURL;
            Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
        }
    });

    test("keeps an explicitly stable public URL after the signing TTL", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousNow = Date.now;
        const startedAt = 1_800_000_000_000;
        let now = startedAt;
        let apiCalls = 0;
        Date.now = () => now;
        apiClient.defaults.adapter = async (config) => {
            apiCalls += 1;
            return {
                data: { code: 0, data: { url: "https://kraftreel.cn-nb2.rains3.com/kraftreel/objects/34/object.png", stable: true }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        };
        try {
            await expect(getResourceDirectUrl("resource:stable-public-url")).resolves.toContain("rains3.com");
            now += 6 * 60 * 1000;
            await expect(getResourceDirectUrl("resource:stable-public-url")).resolves.toContain("rains3.com");
            expect(apiCalls).toBe(1);
        } finally {
            Date.now = previousNow;
            apiClient.defaults.adapter = previousAdapter;
        }
    });

    test("throws instead of navigating when the provider download is not successful", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousDocument = globalThis.document;
        const previousFetch = globalThis.fetch;
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                createElement: () => ({ href: "", rel: "", download: "", style: { display: "" }, click() {}, remove() {} }),
                body: { appendChild() {} },
            },
        });
        apiClient.defaults.adapter = async (config) => ({
            data: { code: 0, data: { url: "https://storage.example/missing.jpg" }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        });
        globalThis.fetch = (async () => new Response("missing", { status: 404 })) as typeof fetch;
        try {
            await expect(startResourceDownload(resourceDownloadUrl("download-missing"))).rejects.toThrow("资源下载失败");
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            globalThis.fetch = previousFetch;
            Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
        }
    });

    test("keeps local resources on the attachment file route", async () => {
        const previousAdapter = apiClient.defaults.adapter;
        const previousDocument = globalThis.document;
        let clickedHref = "";
        const anchor = {
            href: "",
            rel: "",
            download: "",
            style: { display: "" },
            click() {
                clickedHref = this.href;
            },
            remove() {},
        };
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                createElement: () => anchor,
                body: { appendChild() {} },
            },
        });
        apiClient.defaults.adapter = async () => ({
            data: { code: 0, data: { url: "", proxy: true }, msg: "" },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as never,
        });
        try {
            await startResourceDownload(resourceDownloadUrl("download-local"));
            expect(clickedHref).toBe("/api/resources/download-local/file?download=1");
        } finally {
            apiClient.defaults.adapter = previousAdapter;
            Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
        }
    });

});
