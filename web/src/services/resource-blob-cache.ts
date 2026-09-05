import { createLazyLocalForage } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { getResourceBlob, resourceIdFromStorageKey } from "@/services/api/resources";

type ResourceCacheMeta = {
    key: string;
    userScope: string;
    resourceId: string;
    version: string;
    size: number;
    mimeType: string;
    lastAccessedAt: number;
};

const getBlobStore = createLazyLocalForage({ name: "infinite-canvas", storeName: "resource_blobs" });
const getMetaStore = createLazyLocalForage({ name: "infinite-canvas", storeName: "resource_blob_meta" });
const objectUrls = new Map<string, string>();
const sessionBlobs = new Map<string, Blob>();
const inFlight = new Map<string, Promise<string>>();
const scheduled = new Set<string>();
const downloadQueue: Array<() => void> = [];
let activeDownloads = 0;
let persistQueue: Promise<void> = Promise.resolve();
let cacheGeneration = 0;
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const FALLBACK_CACHE_BYTES = 512 * 1024 * 1024;
const MIN_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 500;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_DOWNLOADS = 4;

export async function getCachedResourceObjectUrl(storageKey: string) {
    const generation = cacheGeneration;
    const scope = getActiveUserScope();
    const target = await cacheTarget(storageKey);
    if (!target) return "";
    if (generation !== cacheGeneration || scope !== getActiveUserScope()) return "";
    const value = await readCachedObjectUrl(target);
    return generation === cacheGeneration && scope === getActiveUserScope() ? value : "";
}

export async function cacheResourceObjectUrl(storageKey: string, options?: { proxyFallback?: boolean }) {
    const generation = cacheGeneration;
    const scope = getActiveUserScope();
    const target = await cacheTarget(storageKey);
    if (!target) return "";
    if (generation !== cacheGeneration || scope !== getActiveUserScope()) return "";
    const cached = await readCachedObjectUrl(target);
    if (generation !== cacheGeneration || scope !== getActiveUserScope()) return "";
    if (cached) return cached;
    const pending = inFlight.get(target.key);
    if (pending) {
        const value = await pending;
        return generation === cacheGeneration && scope === getActiveUserScope() ? value : "";
    }

    const task = withDownloadSlot(() => downloadAndCacheResource(storageKey, target, generation, options)).finally(() => {
        if (inFlight.get(target.key) === task) inFlight.delete(target.key);
    });
    inFlight.set(target.key, task);
    const value = await task;
    return generation === cacheGeneration && scope === getActiveUserScope() ? value : "";
}

/**
 * 播放器先使用支持 Range 的资源 URL 起播；确认用户实际播放后，再延迟下载完整 Blob。
 * 这样不会让 IndexedDB 缓存阻塞首帧，同时后续打开可直接复用本地 Object URL。
 */
export function scheduleResourceBlobCache(storageKey: string, delayMs = 4_000) {
    if (!resourceIdFromStorageKey(storageKey) || scheduled.has(storageKey)) return;
    scheduled.add(storageKey);
    const run = () => {
        void cacheResourceObjectUrl(storageKey)
            .catch(() => "")
            .finally(() => scheduled.delete(storageKey));
    };
    if (typeof window === "undefined") {
        run();
        return;
    }
    window.setTimeout(run, Math.max(0, delayMs));
}

function withDownloadSlot<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
        downloadQueue.push(() => {
            activeDownloads += 1;
            task()
                .then(resolve, reject)
                .finally(() => {
                    activeDownloads -= 1;
                    runDownloadQueue();
                });
        });
        runDownloadQueue();
    });
}

function runDownloadQueue() {
    while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length) downloadQueue.shift()?.();
}

export async function primeResourceBlobCache(storageKey: string, blob: Blob) {
    const target = await cacheTarget(storageKey);
    if (!target) return "";
    if (target.userScope !== getActiveUserScope()) return "";
    sessionBlobs.set(target.key, blob);
    const url = objectUrl(target.key, blob);
    if (blob.size <= MAX_CACHE_BYTES) void enqueuePersist(target, blob);
    return url;
}

export async function getCachedResourceBlob(storageKey: string) {
    const generation = cacheGeneration;
    const scope = getActiveUserScope();
    const target = await cacheTarget(storageKey);
    if (!target) return null;
    if (generation !== cacheGeneration || scope !== getActiveUserScope()) return null;
    const cached = await getBlobStore().getItem<Blob>(target.key);
    if (generation !== cacheGeneration || scope !== getActiveUserScope()) return null;
    if (cached) {
        void touchCacheMeta(target).catch(() => undefined);
        return cached;
    }
    const sessionBlob = sessionBlobs.get(target.key);
    if (sessionBlob) return sessionBlob;
    const pending = inFlight.get(target.key);
    if (pending) {
        await pending;
        if (generation !== cacheGeneration || scope !== getActiveUserScope()) return null;
        const value = sessionBlobs.get(target.key) || (await getBlobStore().getItem<Blob>(target.key));
        return generation === cacheGeneration && scope === getActiveUserScope() ? value : null;
    }
    await cacheResourceObjectUrl(storageKey);
    if (generation !== cacheGeneration || scope !== getActiveUserScope()) return null;
    const value = sessionBlobs.get(target.key) || (await getBlobStore().getItem<Blob>(target.key));
    return generation === cacheGeneration && scope === getActiveUserScope() ? value : null;
}

async function downloadAndCacheResource(storageKey: string, target: ResourceCacheMeta, generation: number, options?: { proxyFallback?: boolean }) {
    // A queued request may only start after the user has switched accounts or
    // the cache has been cleared. Resolve it as a miss without issuing the old
    // resource ID under the new session.
    if (generation !== cacheGeneration || target.userScope !== getActiveUserScope()) return "";
    const blob = await downloadResourceBlob(storageKey, target, generation, options);
    if (!blob) return "";
    return objectUrl(target.key, blob);
}

async function downloadResourceBlob(storageKey: string, target: ResourceCacheMeta, generation: number, options?: { proxyFallback?: boolean }) {
    // Read the object directly when provider CORS allows it. A CORS failure
    // falls back to a one-time authenticated stream through the app so the
    // Blob can still enter IndexedDB; the server never persists that copy.
    if (generation !== cacheGeneration || target.userScope !== getActiveUserScope()) return null;
    const blob = await getResourceBlob(storageKey, options);
    if (!blob) return null;
    if (generation !== cacheGeneration || target.userScope !== getActiveUserScope()) return null;
    sessionBlobs.set(target.key, blob);
    if (blob.size <= MAX_CACHE_BYTES) await enqueuePersist(target, blob);
    return blob;
}

function enqueuePersist(target: ResourceCacheMeta, blob: Blob) {
    const task = persistQueue.then(() => persistBlob(target, blob));
    persistQueue = task.catch(() => undefined);
    return task.catch(() => undefined);
}

async function persistBlob(target: ResourceCacheMeta, blob: Blob) {
    // 不尝试写入超过当前缓存预算的单个媒体，避免触发浏览器配额异常和无效的全量淘汰。
    if (blob.size > (await cacheBudget())) return;
    await evictFor(blob.size, target.key);
    try {
        await getBlobStore().setItem(target.key, blob);
        await getMetaStore().setItem(target.key, { ...target, size: blob.size, mimeType: blob.type || target.mimeType, lastAccessedAt: Date.now() });
    } catch (error) {
        await evictFor(blob.size, target.key, true);
        try {
            await getBlobStore().setItem(target.key, blob);
            await getMetaStore().setItem(target.key, { ...target, size: blob.size, mimeType: blob.type || target.mimeType, lastAccessedAt: Date.now() });
        } catch {
            await getBlobStore().removeItem(target.key);
            await getMetaStore().removeItem(target.key);
            throw error;
        }
    }
}

async function readCachedObjectUrl(target: ResourceCacheMeta) {
    const existing = objectUrls.get(target.key);
    if (existing) {
        void touchCacheMeta(target).catch(() => undefined);
        return existing;
    }
    const blob = await getBlobStore().getItem<Blob>(target.key);
    if (!blob) return "";
    void touchCacheMeta(target).catch(() => undefined);
    return objectUrl(target.key, blob);
}

async function cacheTarget(storageKey: string): Promise<ResourceCacheMeta | null> {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) return null;
    const userScope = getActiveUserScope();
    if (userScope === "guest") throw new Error("游客不能读取远程媒体缓存");
    // resource ID 是不可变资源的稳定标识，文件接口本身负责鉴权。
    // 缓存初始化不能先对每个资源读取一遍元数据，否则首屏会重新形成 N+1 请求。
    const version = "file";
    return {
        key: `${userScope}:${resourceId}:${version}`,
        userScope,
        resourceId,
        version,
        size: 0,
        mimeType: "application/octet-stream",
        lastAccessedAt: Date.now(),
    };
}

async function touchCacheMeta(target: ResourceCacheMeta) {
    const current = await getMetaStore().getItem<ResourceCacheMeta>(target.key);
    if (!current || Date.now() - current.lastAccessedAt < TOUCH_INTERVAL_MS) return;
    await getMetaStore().setItem(target.key, { ...current, lastAccessedAt: Date.now() });
}

async function evictFor(incomingBytes: number, protectedKey: string, aggressive = false) {
    const metas: ResourceCacheMeta[] = [];
    await getMetaStore().iterate<ResourceCacheMeta, void>((value) => {
        if (value?.key) metas.push(value);
    });
    const budget = aggressive ? Math.max(MIN_CACHE_BYTES, (await cacheBudget()) / 2) : await cacheBudget();
    let total = metas.reduce((sum, item) => sum + Math.max(0, item.size || 0), 0);
    let count = metas.length;
    // 当前页面正在使用的 Blob URL 不能在 LRU 清理时撤销，否则已渲染节点会立即变成失效资源。
    const candidates = metas.filter((item) => item.key !== protectedKey && !objectUrls.has(item.key) && !sessionBlobs.has(item.key)).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const candidate of candidates) {
        if (total + incomingBytes <= budget && count < MAX_CACHE_ENTRIES) break;
        await removeCacheEntry(candidate);
        total -= Math.max(0, candidate.size || 0);
        count -= 1;
    }
}

async function removeCacheEntry(meta: ResourceCacheMeta) {
    const url = objectUrls.get(meta.key);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(meta.key);
    sessionBlobs.delete(meta.key);
    await Promise.all([getBlobStore().removeItem(meta.key), getMetaStore().removeItem(meta.key)]);
}

async function cacheBudget() {
    if (!navigator.storage?.estimate) return FALLBACK_CACHE_BYTES;
    const estimate = await navigator.storage.estimate().catch(() => null);
    if (!estimate?.quota) return FALLBACK_CACHE_BYTES;
    return Math.min(MAX_CACHE_BYTES, Math.max(MIN_CACHE_BYTES, Math.floor(estimate.quota * 0.2)));
}

function objectUrl(key: string, blob: Blob) {
    const existing = objectUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    objectUrls.set(key, url);
    return url;
}

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", (event) => {
        if (event.persisted) return;
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        objectUrls.clear();
        sessionBlobs.clear();
    });
}

/** Releases in-memory Blob URLs and ignores late downloads after account changes. */
export function clearResourceBlobCache() {
    cacheGeneration += 1;
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
    sessionBlobs.clear();
    inFlight.clear();
}
