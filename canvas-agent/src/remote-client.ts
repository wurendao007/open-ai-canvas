import { loadRemoteConfig, loadProjectSelection, normalizeServerUrl, saveRemoteConfig, type ProjectSelection, type RemoteCredentials } from "./remote-config.js";

export type RemoteEnvelope<T> = { code: number; data: T; msg: string };
export class RemoteMcpError extends Error {
    constructor(public readonly status: number, message: string, public readonly data?: unknown) { super(message); this.name = "RemoteMcpError"; }
}

export class RemoteMcpClient {
    private credentials: RemoteCredentials;
    private refreshPromise: Promise<void> | null = null;
    constructor(credentials = loadRemoteConfig() ?? undefined) {
        if (!credentials) throw new Error("尚未登录 Canvas 服务，请先运行 canvas-agent login web");
        this.credentials = { ...credentials, serverUrl: normalizeServerUrl(credentials.serverUrl) };
    }
    get serverUrl() { return this.credentials.serverUrl; }
    get accessToken() { return this.credentials.accessToken; }

    async request<T>(path: string, options: { method?: string; body?: unknown; dispatchedWrite?: boolean; retryAuth?: boolean } = {}): Promise<T> {
        const method = options.method || "GET";
        const dispatchedWrite = options.dispatchedWrite ?? (method !== "GET" && /\/tools\/(apply|generate)$/.test(path));
        let authRetried = false;
        let rateRetried = false;
        for (;;) {
            const response = await fetch(`${this.serverUrl}/api${path.startsWith("/") ? path : `/${path}`}`, {
                method,
                headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }), authorization: `Bearer ${this.credentials.accessToken}` },
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
            });
            if (response.status === 401 && !authRetried && options.retryAuth !== false) {
                authRetried = true;
                if (dispatchedWrite) {
                    try { await this.refresh(); } catch { /* preserve the dispatched-write boundary below */ }
                    throw new RemoteMcpError(401, "登录已失效；已发送的写操作不会自动重放");
                }
                await this.refresh();
                continue;
            }
            if (response.status === 429 && !rateRetried) {
                if (dispatchedWrite) {
                    const raw = await response.text();
                    const envelope = parseEnvelope<unknown>(raw);
                    throw new RemoteMcpError(429, envelope?.msg || "远程请求被限流；已发送的写操作不会自动重放", envelope?.data);
                }
                rateRetried = true;
                const delayMs = retryAfterDelay(response.headers.get("retry-after"));
                if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
            }
            const raw = await response.text();
            const envelope = parseEnvelope<T>(raw);
            if (!response.ok || !envelope || envelope.code !== 0) {
                const status = envelope && envelope.code !== 0 ? envelope.code : response.status || 500;
                throw new RemoteMcpError(status, envelope?.msg || `远程请求失败 (${status})`, envelope?.data);
            }
            return envelope.data;
        }
    }

    private async refresh() {
        if (!this.refreshPromise) {
            this.refreshPromise = (async () => {
                const response = await fetch(`${this.serverUrl}/api/mcp/auth/refresh`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ refresh_token: this.credentials.refreshToken }) });
                const raw = await response.text();
                let envelope: RemoteEnvelope<{ access_token: string; refresh_token: string; expires_in?: number }> | undefined;
                try { envelope = JSON.parse(raw) as typeof envelope; } catch { /* below */ }
                if (!response.ok || !envelope || envelope.code !== 0 || !envelope.data?.access_token || !envelope.data.refresh_token) throw new RemoteMcpError(envelope && envelope.code !== 0 ? envelope.code : response.status || 401, envelope?.msg || "登录已失效，请重新登录");
                this.credentials = { ...this.credentials, accessToken: envelope.data.access_token, refreshToken: envelope.data.refresh_token, expiresAt: envelope.data.expires_in ? Date.now() + envelope.data.expires_in * 1_000 : undefined };
                saveRemoteConfig(this.credentials);
            })().finally(() => { this.refreshPromise = null; });
        }
        await this.refreshPromise;
    }

    listProjects() { return this.request<Array<Record<string, unknown>>>("/mcp/projects"); }
    getProject(id = this.requireSelection().projectId) { return this.request<Record<string, unknown>>(`/mcp/projects/${encodeURIComponent(id)}`); }
    validate(id: string, body: unknown) { return this.request<Record<string, unknown>>(`/mcp/projects/${encodeURIComponent(id)}/tools/validate`, { method: "POST", body, dispatchedWrite: false }); }
    apply(id: string, body: unknown) { return this.request<Record<string, unknown>>(`/mcp/projects/${encodeURIComponent(id)}/tools/apply`, { method: "POST", body, dispatchedWrite: true }); }
    generate(id: string, body: unknown) { return this.request<Record<string, unknown>>(`/mcp/projects/${encodeURIComponent(id)}/tools/generate`, { method: "POST", body, dispatchedWrite: true }); }
    requireSelection(): ProjectSelection { const selection = loadProjectSelection(); if (!selection) throw new Error("尚未选择画布项目，请先运行 canvas-agent project list 和 project use <id>"); return selection; }
}

export function createRemoteClient() { return new RemoteMcpClient(); }

function retryAfterDelay(value: string | null, now = Date.now()) {
    if (!value) return 0;
    const seconds = Number(value.trim());
    if (Number.isFinite(seconds)) return Math.min(Math.max(0, seconds * 1_000), 30_000);
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 0;
    return Math.min(Math.max(0, timestamp - now), 30_000);
}

function parseEnvelope<T>(raw: string): RemoteEnvelope<T> | undefined {
    try { return raw ? JSON.parse(raw) as RemoteEnvelope<T> : undefined; } catch { return undefined; }
}
