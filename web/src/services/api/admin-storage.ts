import { apiBaseURL, apiClient, compactApiParams, request } from "@/services/api/request";

export type AdminStorageResource = {
    id: string;
    userId: string;
    userName: string;
    kind: "image" | "video" | "audio" | "file" | string;
    status: "pending" | "ready" | "failed" | "deleted" | string;
    provider: string;
    bucket?: string;
    objectKey: string;
    mimeType: string;
    size: number;
    physicalBytes: number;
    width: number;
    height: number;
    durationMs: number;
    fileUrl: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminResourcePage = {
    items: AdminStorageResource[];
    total: number;
    page: number;
    limit: number;
};

export type AdminStorageDimensionStat = {
    count: number;
    logicalBytes: number;
    physicalBytes: number;
};

export type AdminStorageStats = {
    resourceCount: number;
    readyCount: number;
    logicalBytes: number;
    physicalBytes: number;
    localBytes: number;
    remoteBytes: number;
    byKind: Array<AdminStorageDimensionStat & { kind: string }>;
    byProvider: Array<AdminStorageDimensionStat & { provider: string }>;
};

export type AdminResourceQuery = {
    keyword?: string;
    kind?: string;
    status?: string;
    provider?: string;
    userId?: string;
    page?: number;
    limit?: number;
};

export type AdminResourceReference = {
    kind: string;
    id: string;
    title: string;
};

export type AdminResourceDeleteBlocked = {
    id: string;
    reason: string;
    references: AdminResourceReference[];
};

export type AdminResourceDeleteResult = {
    deleted: string[];
    blocked: AdminResourceDeleteBlocked[];
};

export async function listAdminResources(query: AdminResourceQuery, signal?: AbortSignal) {
    return request<AdminResourcePage>(apiClient.get("/admin/resources", { params: compactApiParams(query), signal }));
}

export async function getAdminStorageStats(signal?: AbortSignal) {
    const result = await request<{ stats: AdminStorageStats }>(apiClient.get("/admin/storage/stats", { signal }));
    return result.stats;
}

export function deleteAdminResources(resourceIds: string[]) {
    return request<AdminResourceDeleteResult>(apiClient.post("/admin/resources/delete", { resourceIds }));
}

export function adminResourceFileUrl(id: string, download = false) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/admin/resources/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}`;
}

export async function getAdminResourceDirectUrl(id: string) {
    const result = await request<{ url: string; proxy?: boolean }>(apiClient.get(`/admin/resources/${encodeURIComponent(id)}/direct-url`));
    if (result.proxy) return adminResourceFileUrl(id);
    if (!result.url) throw new Error("后端未返回对象存储地址");
    return result.url;
}

export function downloadAdminResource(resource: AdminStorageResource) {
    const anchor = document.createElement("a");
    anchor.href = adminResourceFileUrl(resource.id, true);
    anchor.click();
}
