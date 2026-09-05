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

test("workflow planning preserves references, per-node run flags, dimensions, and gap", () => {
    const planned = planTool("canvas_create_workflow", {
        title: "角色工作流",
        gap: 180,
        nodes: [
            { ref: "cards", kind: "character_cards", title: "角色卡", runGeneration: true, width: 700, height: 400 },
            { ref: "shot", kind: "storyboard_video", title: "分镜视频", referenceRefs: ["cards"], referenceNodeIds: ["existing"], prompt: "镜头提示" },
        ],
    }, { nodes: [{ id: "existing", type: "image", position: { x: 0, y: 0 }, width: 100, height: 100 }], connections: [], revision: 3 });
    const ops = planned.input.ops as Array<Record<string, unknown>>;
    const cards = ops.find((op) => op.type === "add_node" && op.id?.toString().includes("cards"));
    const shot = ops.find((op) => op.type === "add_node" && op.id?.toString().includes("shot"));
    assert.deepEqual((cards?.metadata as Record<string, unknown>).referenceNodeIds, undefined);
    assert.deepEqual((shot?.metadata as Record<string, unknown>).referenceNodeIds, [cards?.id, "existing"]);
    assert.equal(cards?.width, 700);
    assert.equal(cards?.height, 400);
    assert.equal(ops.filter((op) => op.type === "run_generation").length, 1);
    assert.equal(typeof ops.find((op) => op.type === "run_generation")?.id, "string");
    const shotPosition = shot?.position as { x: number; y: number };
    assert.equal(shotPosition.x - ((cards?.position as { x: number }).x + 700), 180);
});
