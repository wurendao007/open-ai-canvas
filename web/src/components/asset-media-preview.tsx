import type { ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { ResolvedResourceAudioSource, ResolvedResourceVideoSource } from "@/components/resolved-resource-video";
import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null }: AssetMediaPreviewProps) {
    if (!asset) return fallback;

    if (asset.kind === "video" && asset.data.url) {
        const poster = asset.coverUrl && asset.coverUrl !== asset.data.url ? asset.coverUrl : undefined;
        return (
            <ResolvedResourceVideoSource
                src={asset.data.url}
                storageKey={asset.data.storageKey}
                fallback={asset.data.url}
                poster={poster}
                aria-label={alt}
                muted
                playsInline
                preload="metadata"
                className={className}
                onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (!poster && video.currentTime === 0 && video.duration > 0) video.currentTime = Math.min(0.001, video.duration);
                }}
            />
        );
    }

    if (asset.kind === "audio" && asset.data.url) {
        return <ResolvedResourceAudioSource src={asset.data.url} storageKey={asset.data.storageKey} fallback={asset.data.url} controls preload="metadata" className={className} />;
    }

    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={imageUrl} alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} />;
}
