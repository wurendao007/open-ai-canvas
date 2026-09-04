import { expect, test } from "bun:test";

test("MCP device approval route is public and actionable", async () => {
    const router = await Bun.file(new URL("../src/router.tsx", import.meta.url)).text();
    const page = await Bun.file(new URL("../src/pages/mcp/device.tsx", import.meta.url)).text();
    expect(router).toContain('path: "/mcp/device"');
    expect(router).not.toContain('path: "/mcp/device", element: <RequireAuth>');
    expect(page).toContain("/mcp/auth/device/");
    expect(page).toContain("批准");
    expect(page).toContain("拒绝");
});
