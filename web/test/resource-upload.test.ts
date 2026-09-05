import { afterEach, describe, expect, test } from "bun:test";

import { apiClient } from "../src/services/api/request";
import { clearResourceClientCaches, getResource, refreshResource, uploadResourceFile, type RemoteResource } from "../src/services/api/resources";

const previousAdapter = apiClient.defaults.adapter;

afterEach(() => {
    apiClient.defaults.adapter = previousAdapter;
    clearResourceClientCaches();
});

function resource(id: string, playbackStatus = "none"): RemoteResource {
    return {
        id,
        userId: "user-1",
        kind: "video",
        status: "ready",
        provider: "local",
        endpoint: "",
        bucket: "",
        objectKey: `${id}.mp4`,
        publicUrl: "",
        mimeType: "video/mp4",
        size: 1,
        playbackStatus,
        createdAt: "2026-09-05T00:00:00Z",
        updatedAt: "2026-09-05T00:00:00Z",
    };
}

describe("resource uploads", () => {
    test("switches files over 50MB to the chunk upload protocol", async () => {
        const size = (50 << 20) + 1;
        const file = new Blob(["x"], { type: "video/mp4" });
        Object.defineProperty(file, "size", { value: size });
        const calls: string[] = [];
        const progress: number[] = [];

        apiClient.defaults.adapter = async (config) => {
            calls.push(`${config.method}:${config.url}`);
            if (config.url === "/resources/uploads") {
                const payload = JSON.parse(String(config.data));
                expect(payload.idempotencyKey).toBe("upload-key");
                return { data: { code: 0, data: { uploadId: "upload-1", chunkSize: 8 << 20, chunkCount: 7 }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
            }
            if (config.url === "/resources/uploads/upload-1/complete") {
                return { data: { code: 0, data: { resource: resource("uploaded") }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
            }
            const index = Number(config.url?.split("/").pop());
            return { data: { code: 0, data: { index }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        };

        await expect(uploadResourceFile(file, "video", { fileName: "movie.mp4", idempotencyKey: "upload-key" }, (uploaded) => progress.push(uploaded))).resolves.toMatchObject({ id: "uploaded" });
        expect(calls.filter((call) => call.startsWith("put:"))).toHaveLength(7);
        expect(calls).not.toContain("post:/resources");
        expect(progress.at(-1)).toBe(size);
    });

    test("refreshResource bypasses the resource cache", async () => {
        let calls = 0;
        apiClient.defaults.adapter = async (config) => {
            calls += 1;
            const value = resource("transcoding", calls === 1 ? "processing" : "ready");
            return { data: { code: 0, data: { resource: value }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        };

        await expect(getResource("transcoding")).resolves.toMatchObject({ playbackStatus: "processing" });
        await expect(getResource("transcoding")).resolves.toMatchObject({ playbackStatus: "processing" });
        await expect(refreshResource("transcoding")).resolves.toMatchObject({ playbackStatus: "ready" });
        expect(calls).toBe(2);
    });
});
