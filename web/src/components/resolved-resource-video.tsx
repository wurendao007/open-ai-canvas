import { useEffect, useRef, useState, type AudioHTMLAttributes, type SyntheticEvent, type VideoHTMLAttributes } from "react";

import { resourceFallbackUrl, resourceIdFromFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";

type ResolvedResourceVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
    resourceId: string;
    fallback?: string;
};

/** Resolves an owned resource to a short-lived provider URL before mounting video. */
export function ResolvedResourceVideo({ resourceId, fallback = "", ...props }: ResolvedResourceVideoProps) {
    const { onError, ...videoProps } = props;
    const { src, refresh } = useResolvedResourceUrl(resourceId, fallback);
    if (!src) return null;
    return <video {...videoProps} src={src} onError={(event) => handleMediaError(event, refresh, onError)} />;
}

type ResolvedResourceVideoSourceProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
    src?: string;
    storageKey?: string;
    fallback?: string;
};

/** Resolves legacy /file URLs while leaving external and local URLs untouched. */
export function ResolvedResourceVideoSource({ src = "", storageKey, fallback = src, ...props }: ResolvedResourceVideoSourceProps) {
    const resourceId = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(src);
    if (resourceId) return <ResolvedResourceVideo resourceId={resourceId} fallback={fallback} {...props} />;
    if (!src) return null;
    return <video {...props} src={src} />;
}

type ResolvedResourceAudioProps = Omit<AudioHTMLAttributes<HTMLAudioElement>, "src"> & {
    resourceId: string;
    fallback?: string;
};

export function ResolvedResourceAudio({ resourceId, fallback = "", ...props }: ResolvedResourceAudioProps) {
    const { onError, ...audioProps } = props;
    const { src, refresh } = useResolvedResourceUrl(resourceId, fallback);
    if (!src) return null;
    return <audio {...audioProps} src={src} onError={(event) => handleMediaError(event, refresh, onError)} />;
}

type ResolvedResourceAudioSourceProps = Omit<AudioHTMLAttributes<HTMLAudioElement>, "src"> & {
    src?: string;
    storageKey?: string;
    fallback?: string;
};

export function ResolvedResourceAudioSource({ src = "", storageKey, fallback = src, ...props }: ResolvedResourceAudioSourceProps) {
    const resourceId = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(src);
    if (resourceId) return <ResolvedResourceAudio resourceId={resourceId} fallback={fallback} {...props} />;
    if (!src) return null;
    return <audio {...props} src={src} />;
}

function useResolvedResourceUrl(resourceId: string, fallback: string) {
    const safeFallback = resourceFallbackUrl(resourceId, fallback);
    const [src, setSrc] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const retryAttemptedRef = useRef(false);
    useEffect(() => {
        retryAttemptedRef.current = false;
        setRefreshVersion(0);
    }, [fallback, resourceId]);
    useEffect(() => {
        let cancelled = false;
        setSrc("");
        void resolveMediaUrl(resourceStorageKey(resourceId), safeFallback, { forceRefresh: refreshVersion > 0 })
            .then((url) => {
                if (!cancelled) setSrc(url || safeFallback);
            })
            .catch(() => {
                if (!cancelled) setSrc(safeFallback);
            });
        return () => {
            cancelled = true;
        };
    }, [refreshVersion, resourceId, safeFallback]);
    return {
        src,
        refresh: () => {
            if (retryAttemptedRef.current) return false;
            retryAttemptedRef.current = true;
            setRefreshVersion((value) => value + 1);
            return true;
        },
    };
}

function handleMediaError<T extends HTMLMediaElement>(event: SyntheticEvent<T>, refresh: () => boolean, onError?: (event: SyntheticEvent<T>) => void) {
    if (!refresh()) onError?.(event);
}
