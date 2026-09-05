import { expect, test } from "bun:test";

import { readSourceText } from "./helpers/read-source";

test("Canvas Agent no longer exposes the local connection mode", async () => {
    const chrome = await readSourceText(new URL("../src/components/canvas/canvas-agent-panel-chrome.tsx", import.meta.url));
    const assistant = await readSourceText(new URL("../src/components/canvas/canvas-assistant-panel.tsx", import.meta.url));
    const project = await readSourceText(new URL("../src/pages/canvas/project.tsx", import.meta.url));
    const canvasIndex = await readSourceText(new URL("../src/pages/canvas/index.tsx", import.meta.url));
    const topBar = await readSourceText(new URL("../src/pages/canvas/canvas-project-top-bar.tsx", import.meta.url));
    const visibility = await readSourceText(new URL("../src/pages/canvas/use-canvas-assistant-visibility.ts", import.meta.url));

    expect(chrome).not.toContain('(["online", "local"] as const)');
    expect(chrome).not.toContain('item === "local" ? "本机"');
    expect(assistant).not.toContain("CanvasLocalAgentPanel");
    expect(assistant).not.toContain('agentMode === "local"');
    expect(project).not.toContain("autoConnectLocal");
    expect(project).not.toContain("codexCompactAgent");
    expect(project).not.toContain("CanvasLocalAgentPanel");
    expect(canvasIndex).not.toContain("agentUrl");
    expect(canvasIndex).not.toContain("agentToken");
    expect(topBar).not.toContain("CompactAgentStatus");
    expect(visibility).not.toContain("CanvasAgentMode");
    expect(visibility).not.toContain("setAgentMode");
});
