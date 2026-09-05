import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteMcpClient, RemoteMcpError } from "../src/remote-client.js";

test("RemoteMcpClient unwraps envelopes and refreshes once for an idempotent read", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input) => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ code: 401, msg: "expired" }), { status: 401 });
        if (calls === 2) return new Response(JSON.stringify({ code: 0, data: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 900 }, msg: "" }), { status: 200 });
        return new Response(JSON.stringify({ code: 0, data: { ok: true }, msg: "" }), { status: 200 });
    };
    try {
        const client = new RemoteMcpClient({ serverUrl: "https://canvas.example", accessToken: "old-access", refreshToken: "old-refresh" });
        assert.deepEqual(await client.request("/mcp/projects"), { ok: true });
        assert.equal(calls, 3);
    } finally { globalThis.fetch = original; }
});

test("RemoteMcpClient never replays a dispatched write after 401", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ code: 401, msg: "expired" }), { status: 401 });
        return new Response(JSON.stringify({ code: 0, data: { access_token: "new", refresh_token: "new-refresh", expires_in: 900 }, msg: "" }), { status: 200 });
    };
    try {
        const client = new RemoteMcpClient({ serverUrl: "https://canvas.example", accessToken: "access", refreshToken: "refresh" });
        await assert.rejects(() => client.apply("project", { ops: [] }), (error: unknown) => error instanceof RemoteMcpError && error.status === 401);
        assert.equal(calls, 2);
    } finally { globalThis.fetch = original; }
});

test("RemoteMcpClient maps non-success envelopes to structured errors", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 409, msg: "conflict", data: { revision: 2 } }), { status: 409 });
    try {
        const client = new RemoteMcpClient({ serverUrl: "https://canvas.example", accessToken: "access", refreshToken: "refresh" });
        await assert.rejects(() => client.request("/mcp/projects/p"), (error: unknown) => error instanceof RemoteMcpError && error.status === 409 && error.data?.revision === 2);
    } finally { globalThis.fetch = original; }
});

test("RemoteMcpClient preserves the no-replay boundary for dispatched 429 writes", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify({ code: 429, msg: "rate limited", data: { retryAfter: 10 } }), { status: 429, headers: { "retry-after": "10" } });
    };
    try {
        const client = new RemoteMcpClient({ serverUrl: "https://canvas.example", accessToken: "access", refreshToken: "refresh" });
        await assert.rejects(() => client.apply("project", { ops: [] }), (error: unknown) => error instanceof RemoteMcpError && error.status === 429 && error.data?.retryAfter === 10);
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});

test("RemoteMcpClient uses business envelope status codes", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 428, msg: "precondition required" }), { status: 200 });
    try {
        const client = new RemoteMcpClient({ serverUrl: "https://canvas.example", accessToken: "access", refreshToken: "refresh" });
        await assert.rejects(() => client.request("/mcp/projects/p"), (error: unknown) => error instanceof RemoteMcpError && error.status === 428);
    } finally { globalThis.fetch = original; }
});

test("RemoteMcpClient rejects plaintext server URLs", () => {
    assert.throws(() => new RemoteMcpClient({ serverUrl: "http://canvas.example", accessToken: "access", refreshToken: "refresh" }), /HTTPS/);
});
