import { expect, test } from "bun:test";
import localforage from "localforage";

import { apiClient } from "../src/services/api/request";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { remoteCanvasVersionKey, resetRemoteUserDataSync, saveRemoteUserDataNow, scheduleRemoteUserDataSync, syncRemoteUserData } from "../src/services/user-data-sync";

function project(id: string, title: string): CanvasProject {
    return {
        id,
        title,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    };
}

function installBrowserStorage() {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const originalRemoveItem = localforage.removeItem.bind(localforage);
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: (handler: () => void) => {
                queueMicrotask(handler);
                return 1;
            },
            clearTimeout: () => undefined,
            localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    localforage.removeItem = (async (key: string) => {
        values.delete(key);
    }) as typeof localforage.removeItem;
    return () => {
        localforage.getItem = originalGetItem as typeof localforage.getItem;
        localforage.setItem = originalSetItem as typeof localforage.setItem;
        localforage.removeItem = originalRemoveItem as typeof localforage.removeItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    };
}

function installRemoteAdapter(options: { project: CanvasProject; revision: number; stateHash: string; conflict?: boolean }) {
    const previousAdapter = apiClient.defaults.adapter;
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    apiClient.defaults.adapter = async (config) => {
        const method = String(config.method || "get").toLowerCase();
        const url = String(config.url || "");
        const body = typeof config.data === "string" ? JSON.parse(config.data) as Record<string, unknown> : config.data as Record<string, unknown> | undefined;
        requests.push({ method, url, body });
        if (url.includes("user-data/snapshot")) {
            return {
                data: { code: 0, data: { projects: [options.project], assets: [], projectVersions: [{ id: options.project.id, title: options.project.title, createdAt: options.project.createdAt, updatedAt: options.project.updatedAt, revision: options.revision, stateHash: options.stateHash, hashSource: "server" }] }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        }
        if (method === "put" && url.startsWith("/canvas-projects/")) {
            if (options.conflict) {
                return Promise.reject({
                    isAxiosError: true,
                    message: "Request failed with status code 409",
                    response: { status: 409, data: { code: 409, data: { revision: options.revision + 1, stateHash: "other-window-hash" }, msg: "画布已被其他窗口或 MCP 修改，请重新加载/合并" } },
                });
            }
            return {
                data: { code: 0, data: { project: { id: options.project.id, title: options.project.title, createdAt: options.project.createdAt, updatedAt: options.project.updatedAt, revision: options.revision + 1, stateHash: "next-server-hash", hashSource: "server" } }, msg: "" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        }
        throw new Error(`unexpected request: ${method} ${url}`);
    };
    return { requests, restore: () => { apiClient.defaults.adapter = previousAdapter; } };
}

async function flushMicrotasks() {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

test("remote canvas saves use server revision/hash and acknowledge the next version", async () => {
    const restoreStorage = installBrowserStorage();
    const previousProjects = useCanvasStore.getState().projects;
    const originalScope = getActiveUserScope();
    const remote = project("canvas-remote-version", "远端初稿");
    const adapter = installRemoteAdapter({ project: remote, revision: 4, stateHash: "server-hash-4" });
    try {
        resetRemoteUserDataSync();
        setActiveUserScope("account-remote-version");
        await syncRemoteUserData("account-remote-version");
        useCanvasStore.getState().updateProject(remote.id, { title: "本地二稿" });
        await saveRemoteUserDataNow();

        const writes = adapter.requests.filter((request) => request.method === "put");
        expect(writes).toHaveLength(1);
        expect(writes[0]?.body).toMatchObject({ expectedRevision: 4, expectedStateHash: "server-hash-4" });
        expect(writes[0]?.body?.project).not.toHaveProperty("revision");
        expect(writes[0]?.body?.project).not.toHaveProperty("stateHash");

        useCanvasStore.getState().updateProject(remote.id, { title: "本地三稿" });
        await saveRemoteUserDataNow();
        const secondWrite = adapter.requests.filter((request) => request.method === "put")[1];
        expect(secondWrite?.body).toMatchObject({ expectedRevision: 5, expectedStateHash: "next-server-hash" });
    } finally {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: previousProjects });
        await flushCanvasStorePersistence();
        setActiveUserScope(originalScope);
        adapter.restore();
        restoreStorage();
    }
});

test("a remote canvas conflict preserves local state and does not retry from a stale version", async () => {
    const restoreStorage = installBrowserStorage();
    const previousProjects = useCanvasStore.getState().projects;
    const originalScope = getActiveUserScope();
    const remote = project("canvas-remote-conflict", "远端初稿");
    const adapter = installRemoteAdapter({ project: remote, revision: 7, stateHash: "server-hash-7", conflict: true });
    try {
        resetRemoteUserDataSync();
        setActiveUserScope("account-remote-conflict");
        await syncRemoteUserData("account-remote-conflict");
        useCanvasStore.getState().updateProject(remote.id, { title: "必须保留的本地编辑" });
        scheduleRemoteUserDataSync();
        await flushMicrotasks();

        const writes = adapter.requests.filter((request) => request.method === "put");
        expect(writes).toHaveLength(1);
        expect(writes[0]?.body).toMatchObject({ expectedRevision: 7, expectedStateHash: "server-hash-7" });
        expect(useCanvasStore.getState().projects[0]?.title).toBe("必须保留的本地编辑");
    } finally {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: previousProjects });
        await flushCanvasStorePersistence();
        setActiveUserScope(originalScope);
        adapter.restore();
        restoreStorage();
    }
});

test("remote canvas version keys include user scope and conflict copy", async () => {
    expect(remoteCanvasVersionKey("account-A", "canvas-1")).not.toBe(remoteCanvasVersionKey("account-B", "canvas-1"));
    const source = await Bun.file(new URL("../src/services/user-data-sync.ts", import.meta.url)).text();
    expect(source).toContain("remoteCanvasVersionKey(activeRemoteUserId, project.id)");
    expect(source).toContain("画布已被其他窗口或 MCP 修改，请重新加载/合并");
    expect(source).toContain("remoteCanvasVersions.clear()");
});
