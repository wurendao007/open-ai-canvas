import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";

import { getResourceDirectUrl, resourceFallbackUrl, resourceIdFromFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { resolveImageUrl } from "@/services/image-storage";

type CachedResourceImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    storageKey?: string;
    src?: string;
    fallback?: ReactNode;
    eager?: boolean;
};

/**
 * 资源图片优先读取按用户隔离的本地 Blob 缓存，避免刷新后再次从对象存储下载。
 * 本地 image: 类型的 storageKey 也会自动从 LocalForage 恢复有效的 Object URL。
 */
export function CachedResourceImage({ storageKey, src = "", fallback = null, eager = false, onError, ...props }: CachedResourceImageProps) {
    const resourceId = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(src);
    const effectiveStorageKey = resourceId ? resourceStorageKey(resourceId) : storageKey;
    const remoteResource = Boolean(resourceId);
    const localImageResource = Boolean(effectiveStorageKey && effectiveStorageKey.startsWith("image:"));
    const targetRef = useRef<HTMLSpanElement>(null);
    const [nearViewport, setNearViewport] = useState(eager || !remoteResource);
    const [cachedSrc, setCachedSrc] = useState(remoteResource ? "" : src);
    const [cacheFailed, setCacheFailed] = useState(false);
    const directRetryRef = useRef(false);

    useEffect(() => {
        if (!remoteResource || eager) {
            setNearViewport(true);
            return;
        }
        const image = targetRef.current;
        if (!image || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setNearViewport(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "240px" },
        );
        observer.observe(image);
        return () => observer.disconnect();
    }, [eager, remoteResource]);

    useEffect(() => {
        let cancelled = false;
        setCacheFailed(false);
        directRetryRef.current = false;

        if (remoteResource && effectiveStorageKey) {
            if (!nearViewport) {
                setCachedSrc("");
                return () => {
                    cancelled = true;
                };
            }
            setCachedSrc("");
            // Try one direct CORS read so the Blob can be reused on later
            // renders. If the bucket has no CORS, resolveImageUrl falls back
            // to the signed URL for <img> without proxying through /file.
            const resolve = resolveImageUrl(effectiveStorageKey, src, { cacheMiss: true, proxyFallback: false });
            void resolve
                .then((url) => {
                    if (!cancelled) setCachedSrc(url || resourceFallbackUrl(resourceId, src));
                })
                .catch(() => {
                    if (!cancelled) setCacheFailed(true);
                });
            return () => {
                cancelled = true;
            };
        }

        if (localImageResource && effectiveStorageKey) {
            void resolveImageUrl(effectiveStorageKey, src)
                .then((url) => {
                    if (!cancelled) setCachedSrc(url || src);
                })
                .catch(() => {
                    if (!cancelled) setCachedSrc(src);
                });
            return () => {
                cancelled = true;
            };
        }

        setCachedSrc(src);
        return () => {
            cancelled = true;
        };
    }, [effectiveStorageKey, localImageResource, nearViewport, remoteResource, src]);

    const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        if (remoteResource && effectiveStorageKey && !directRetryRef.current) {
            directRetryRef.current = true;
            void getResourceDirectUrl(effectiveStorageKey, { forceRefresh: true })
                .then((url) => {
                    if (url && url !== cachedSrc) {
                        setCachedSrc(url);
                        return;
                    }
                    setCacheFailed(true);
                    onError?.(e);
                })
                .catch(() => {
                    setCacheFailed(true);
                    onError?.(e);
                });
            return;
        }
        if (localImageResource && effectiveStorageKey && cachedSrc.startsWith("blob:")) {
            void resolveImageUrl(effectiveStorageKey)
                .then((url) => {
                    if (url && url !== cachedSrc) {
                        setCachedSrc(url);
                        return;
                    }
                    setCacheFailed(true);
                    onError?.(e);
                })
                .catch(() => {
                    setCacheFailed(true);
                    onError?.(e);
                });
            return;
        }
        setCacheFailed(true);
        onError?.(e);
    };

    if (!remoteResource) {
        if (cacheFailed && fallback) return <>{fallback}</>;
        return <img {...props} src={cachedSrc} onError={handleImgError} />;
    }
    return (
        <span ref={targetRef} className="cached-resource-image-shell">
            {cachedSrc && !(cacheFailed && !src) ? <img {...props} src={cachedSrc} onError={handleImgError} /> : fallback}
        </span>
    );
}
