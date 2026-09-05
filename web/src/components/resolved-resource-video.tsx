import { useEffect, useRef, useState, type AudioHTMLAttributes, type SyntheticEvent, type VideoHTMLAttributes } from "react";

import { resourceFallbackUrl, resourceIdFromFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";

type ResolvedResourceVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
    resourceId: string;
    fallback?: string;
};

/** Resolves an owned resource to a short-lived provider URL before mounting video. */
export function ResolvedResourceVideo({ resourceId, fallback = "", ...props }: ResolvedResourceVideoProps) {
    const { onError, onLoadedMetadata, ...videoProps } = props;
    const { src, refresh, restoreTime } = useResolvedResourceUrl(resourceId, fallback);
    if (!src) return null;
    return <video {...videoProps} src={src} onLoadedMetadata={(event) => { restoreTime(event.currentTarget); onLoadedMetadata?.(event); }} onError={(event) => handleMediaError(event, refresh, onError)} />;
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
    const { onError, onLoadedMetadata, ...audioProps } = props;
    const { src, refresh, restoreTime } = useResolvedResourceUrl(resourceId, fallback);
    if (!src) return null;
    return <audio {...audioProps} src={src} onLoadedMetadata={(event) => { restoreTime(event.currentTarget); onLoadedMetadata?.(event); }} onError={(event) => handleMediaError(event, refresh, onError)} />;
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
    const maxRefreshAttempts = 2;
    const safeFallback = resourceFallbackUrl(resourceId, fallback);
    const [src, setSrc] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const refreshAttemptsRef = useRef(0);
    const pendingTimeRef = useRef<number | null>(null);
    useEffect(() => {
        refreshAttemptsRef.current = 0;
        pendingTimeRef.current = null;
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
        refresh: (currentTime: number) => {
            if (refreshAttemptsRef.current >= maxRefreshAttempts) return false;
            refreshAttemptsRef.current += 1;
            pendingTimeRef.current = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : null;
            setRefreshVersion((value) => value + 1);
            return true;
        },
        restoreTime: (media: HTMLMediaElement) => {
            const currentTime = pendingTimeRef.current;
            if (currentTime === null) return;
            pendingTimeRef.current = null;
            if (Number.isFinite(media.duration) && media.duration > 0) media.currentTime = Math.min(currentTime, Math.max(0, media.duration - 0.05));
        },
    };
}

function handleMediaError<T extends HTMLMediaElement>(event: SyntheticEvent<T>, refresh: (currentTime: number) => boolean, onError?: (event: SyntheticEvent<T>) => void) {
    if (!refresh(event.currentTarget.currentTime)) onError?.(event);
}
