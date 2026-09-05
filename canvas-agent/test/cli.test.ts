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

test("tool planner gives auto-run operations an idempotency identity", () => {
    const planned = planTool("canvas_generate_image", { prompt: "a forest", expectedRevision: 3, expectedStateHash: "hash" }, { nodes: [], connections: [], revision: 3 });
    const run = (planned.input.ops as Array<Record<string, unknown>>).find((op) => op.type === "run_generation");
    assert.equal(typeof run?.id, "string");
    assert.ok(String(run?.id).length > 8);
});

test("direct generation planning reuses identity for the same logical request", () => {
    const input = { nodeId: "image-1", mode: "image", prompt: "a forest" };
    const first = planTool("canvas_run_generation", input, { nodes: [], connections: [], revision: 3 });
    const second = planTool("canvas_run_generation", input, { nodes: [], connections: [], revision: 3 });
    assert.equal(first.tool, "generate");
    assert.equal((first.input as { clientOperationId: string }).clientOperationId, (second.input as { clientOperationId: string }).clientOperationId);
});
