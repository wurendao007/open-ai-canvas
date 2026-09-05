import { App } from "antd";
import { useState, type ReactNode } from "react";

import { startResourceDownload } from "@/services/api/resources";

type ResourceDownloadButtonProps = {
    url: string;
    fileName?: string;
    className?: string;
    title?: string;
    children: ReactNode;
};

/**
 * Triggers an authenticated resource download and surfaces failures in the SPA.
 *
 * The download helper resolves a short-lived signed URL through the API first,
 * so provider downloads do not need a redirect preflight and API errors remain
 * visible to the SPA as a toast.
 */
export function ResourceDownloadButton({ url, fileName, className, title, children }: ResourceDownloadButtonProps) {
    const { message } = App.useApp();
    const [pending, setPending] = useState(false);
    const download = async () => {
        if (pending) return;
        setPending(true);
        try {
            await startResourceDownload(url, fileName);
        } catch (error) {
            message.error(error instanceof Error ? `下载失败：${error.message}` : "下载失败");
        } finally {
            setPending(false);
        }
    };
    return <button type="button" className={className} title={title} disabled={pending} onClick={() => void download()}>{children}</button>;
}
