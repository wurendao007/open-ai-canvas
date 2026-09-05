import { stdin as input, stdout as output } from "node:process";
import { startMcpServer } from "./mcp-server.js";
import { RemoteMcpClient } from "./remote-client.js";
import { loadProjectSelection, removeProjectSelection, saveProjectSelection, saveRemoteConfig, serverUrl } from "./remote-config.js";

type LoginResponse = { device_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number };

export async function runCli(args: string[], io: { out?: NodeJS.WritableStream; err?: NodeJS.WritableStream } = {}) {
    const out = io.out || output;
    const err = io.err || output;
    try {
        if (args[0] === "mcp") return await startMcpServer();
        if (args[0] === "login" && args[1] === "web") return await loginWeb(out);
        if (args[0] === "project" && args[1] === "list") return await projectList(out);
        if (args[0] === "project" && args[1] === "use" && args[2]) return await projectUse(args[2], out);
        if (args[0] === "project" && args[1] === "unuse") { removeProjectSelection(); out.write("已清除画布项目选择\n"); return; }
        printHelp(out);
        throw new Error("参数无效");
    } catch (error) {
        err.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

async function loginWeb(out: NodeJS.WritableStream) {
    const base = serverUrl();
    const scope = ["canvas:read", "canvas:write", "canvas:generate"];
    const response = await fetch(`${base}/api/mcp/auth/device`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ client_name: "KraftReel CLI", scope }) });
    const envelope = await response.json() as { code: number; data: LoginResponse; msg: string };
    if (!response.ok || envelope.code !== 0) throw new Error(envelope.msg || "无法创建设备登录");
    const uri = new URL(envelope.data.verification_uri_complete || envelope.data.verification_uri, base).toString();
    out.write(`请在浏览器打开并批准：${uri}\n`);
    const deadline = Date.now() + envelope.data.expires_in * 1_000;
    while (Date.now() < deadline) {
        const tokenResponse = await fetch(`${base}/api/mcp/auth/device/token`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ device_code: envelope.data.device_code }) });
        const tokenEnvelope = await tokenResponse.json() as { code: number; data: { status?: string; access_token?: string; refresh_token?: string; expires_in?: number }; msg: string };
        if (tokenEnvelope.code === 0 && tokenEnvelope.data.access_token && tokenEnvelope.data.refresh_token) {
            saveRemoteConfig({ serverUrl: base, accessToken: tokenEnvelope.data.access_token, refreshToken: tokenEnvelope.data.refresh_token, expiresAt: tokenEnvelope.data.expires_in ? Date.now() + tokenEnvelope.data.expires_in * 1_000 : undefined });
            out.write("登录成功\n");
            return;
        }
        if (["denied", "expired", "invalid"].includes(tokenEnvelope.data?.status || "")) throw new Error(`设备登录${tokenEnvelope.data.status}`);
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, envelope.data.interval || 5) * 1_000));
    }
    throw new Error("设备登录已超时");
}

async function projectList(out: NodeJS.WritableStream) {
    const projects = await new RemoteMcpClient().listProjects();
    for (const project of projects) out.write(`${String(project.id)}\t${String(project.title || "未命名画布")}\trevision=${String(project.revision ?? 0)}\n`);
}

async function projectUse(id: string, out: NodeJS.WritableStream) {
    const project = await new RemoteMcpClient().getProject(id);
    const title = typeof project.title === "string" ? project.title : typeof (project.project as Record<string, unknown> | undefined)?.title === "string" ? String((project.project as Record<string, unknown>).title) : undefined;
    saveProjectSelection({ projectId: id, title });
    out.write(`已选择画布 ${id}${title ? `（${title}）` : ""}\n`);
}

export function printHelp(out: NodeJS.WritableStream = output) {
    out.write("用法：kraftreel login web | project list | project use <id> | project unuse | mcp\n");
}
