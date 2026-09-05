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

export function configDirectory() {
    const value = process.env.YINGCE_CONFIG_DIR?.trim();
    return value ? path.resolve(value) : path.join(os.homedir(), ".yingce");
}

export function credentialsPath() { return path.join(configDirectory(), "credentials.json"); }
export function projectSelectionPath() { return path.join(configDirectory(), "project.json"); }

export function serverUrl() {
    const value = process.env.YINGCE_SERVER_URL?.trim();
    if (!value) throw new Error("请配置 YINGCE_SERVER_URL，例如 https://canvas.example.com");
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("YINGCE_SERVER_URL 必须是没有凭据和查询参数的 HTTP(S) 地址");
    return parsed.origin;
}

export function loadRemoteConfig(): RemoteCredentials | null {
    try {
        const raw = JSON.parse(fs.readFileSync(credentialsPath(), "utf8")) as Partial<RemoteCredentials>;
        if (!raw.serverUrl || !raw.accessToken || !raw.refreshToken) return null;
        return { serverUrl: new URL(raw.serverUrl).origin, accessToken: raw.accessToken, refreshToken: raw.refreshToken, expiresAt: raw.expiresAt };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

export function saveRemoteConfig(value: RemoteCredentials) {
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
