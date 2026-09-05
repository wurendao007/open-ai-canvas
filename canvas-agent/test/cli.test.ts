import assert from "node:assert/strict";
import { test } from "node:test";
import { printHelp } from "../src/cli.js";
import { planTool } from "../src/tool-planner.js";
import type { CanvasSnapshot } from "../src/types.js";

test("CLI help exposes only remote commands", () => {
    let text = "";
    printHelp({ write(value: string) { text += value; return true; } });
    assert.match(text, /login web/);
    assert.match(text, /project use/);
    assert.match(text, /mcp/);
    assert.doesNotMatch(text, /17371|runtime/i);
});

test("tool planner emits versioned apply operations without HTTP or process state", () => {
    const state: CanvasSnapshot = { nodes: [], connections: [], revision: 3 };
    const planned = planTool("canvas_create_text_node", { text: "hello", expectedRevision: 3, expectedStateHash: "hash" }, state);
    assert.equal(planned.tool, "apply");
    assert.equal((planned.input as { expectedRevision: number }).expectedRevision, 3);
    assert.equal(Array.isArray(planned.input.ops), true);
});
