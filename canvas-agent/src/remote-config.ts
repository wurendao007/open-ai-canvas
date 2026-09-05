import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type RemoteCredentials = {
    serverUrl: string;
    accessToken: string;
    refreshToken: string;
    expiresAt?: number;
};

export type ProjectSelection = { projectId: string; title?: string };

/** Hosted service used by the published CLI. Self-hosted deployments can override it. */
export const DEFAULT_SERVER_URL = "https://kraftreel.com";

export function configDirectory() {
    const value = process.env.KRAFTREEL_CONFIG_DIR?.trim() || process.env.YINGCE_CONFIG_DIR?.trim();
    if (value) return path.resolve(value);
    const preferred = path.join(os.homedir(), ".kraftreel");
    if (fs.existsSync(preferred)) return preferred;
    const legacy = path.join(os.homedir(), ".yingce");
    return fs.existsSync(legacy) ? legacy : preferred;
}

export function credentialsPath() { return path.join(configDirectory(), "credentials.json"); }
export function projectSelectionPath() { return path.join(configDirectory(), "project.json"); }

export function normalizeServerUrl(value: string) {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("Canvas 服务地址必须是没有凭据和查询参数的 HTTPS 地址");
    }
    return parsed.origin;
}

export function serverUrl() {
    const value = process.env.KRAFTREEL_SERVER_URL?.trim() || process.env.YINGCE_SERVER_URL?.trim() || DEFAULT_SERVER_URL;
    return normalizeServerUrl(value);
}

export function loadRemoteConfig(): RemoteCredentials | null {
    try {
        const raw = JSON.parse(fs.readFileSync(credentialsPath(), "utf8")) as Partial<RemoteCredentials>;
        if (!raw.serverUrl || !raw.accessToken || !raw.refreshToken) return null;
        return { serverUrl: normalizeServerUrl(raw.serverUrl), accessToken: raw.accessToken, refreshToken: raw.refreshToken, expiresAt: raw.expiresAt };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

export function saveRemoteConfig(value: RemoteCredentials) {
    value = { ...value, serverUrl: normalizeServerUrl(value.serverUrl) };
    fs.mkdirSync(configDirectory(), { recursive: true });
    fs.writeFileSync(credentialsPath(), JSON.stringify(value, null, 2), { mode: 0o600 });
    try { fs.chmodSync(credentialsPath(), 0o600); } catch { /* Windows has no chmod semantics. */ }
}

export function loadProjectSelection(): ProjectSelection | null {
    try {
        const raw = JSON.parse(fs.readFileSync(projectSelectionPath(), "utf8")) as Partial<ProjectSelection>;
        return typeof raw.projectId === "string" && raw.projectId.trim() ? { projectId: raw.projectId, title: raw.title } : null;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

export function saveProjectSelection(selection: ProjectSelection) {
    if (!selection.projectId.trim()) throw new Error("projectId 不能为空");
    fs.mkdirSync(configDirectory(), { recursive: true });
    fs.writeFileSync(projectSelectionPath(), JSON.stringify(selection, null, 2), { mode: 0o600 });
}

export function removeProjectSelection() {
    try { fs.unlinkSync(projectSelectionPath()); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
