import assert from "node:assert/strict";
import { test } from "node:test";
import { printHelp } from "../src/cli.js";
import { planTool } from "../src/tool-planner.js";
import type { CanvasSnapshot } from "../src/types.js";

test("CLI help exposes only remote commands", () => {
    let text = "";
    printHelp({ write(value: string) { text += value; return true; } });
    assert.match(text, /kraftreel/);
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

test("direct generation planning uses the target node prompt when omitted", () => {
    const planned = planTool("canvas_run_generation", { nodeId: "image-1" }, { nodes: [{ id: "image-1", type: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt: "stored prompt" } }], connections: [], revision: 3 });
    assert.equal((planned.input as { prompt: string }).prompt, "stored prompt");
    assert.equal((planned.input as { mode: string }).mode, "image");
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

test("auto-run flow planning reuses its generation identity", () => {
    const input = { prompt: "a forest", expectedRevision: 3, expectedStateHash: "hash" };
    const state = { nodes: [], connections: [], revision: 3 };
    const first = planTool("canvas_generate_image", input, state);
    const second = planTool("canvas_generate_image", input, state);
    const firstRun = (first.input.ops as Array<Record<string, unknown>>).find((op) => op.type === "run_generation");
    const secondRun = (second.input.ops as Array<Record<string, unknown>>).find((op) => op.type === "run_generation");
    assert.equal(firstRun?.id, secondRun?.id);
});

test("generation flow planning derives stable node and generation identities without embedding the prompt", () => {
    const input = { prompt: "a forest with a hidden lake", title: "环境概念", mode: "image", x: 120, y: 80, referenceNodeIds: ["reference-1"], autoRun: true, model: "image-model" };
    const state = { nodes: [{ id: "reference-1", type: "image" as const, position: { x: 0, y: 0 }, width: 100, height: 100 }], connections: [], revision: 3 };
    const first = planTool("canvas_create_generation_flow", input, state);
    const second = planTool("canvas_create_generation_flow", input, state);
    const firstOps = first.input.ops as Array<Record<string, unknown>>;
    const secondOps = second.input.ops as Array<Record<string, unknown>>;
    const firstNodes = firstOps.filter((op) => op.type === "add_node");
    const secondNodes = secondOps.filter((op) => op.type === "add_node");
    assert.deepEqual(firstNodes.map((op) => op.id), secondNodes.map((op) => op.id));
    assert.equal(firstNodes.some((op) => String(op.id).includes(input.prompt)), false);
    assert.equal(firstOps.find((op) => op.type === "run_generation")?.id, secondOps.find((op) => op.type === "run_generation")?.id);
});

test("workflow planning derives stable node and generation identities and isolates distinct requests", () => {
    const state = { nodes: [], connections: [], revision: 3 };
    const input = { title: "角色工作流", nodes: [{ ref: "cards", kind: "character_cards", title: "角色卡", prompt: "角色外观" }], autoRun: true };
    const first = planTool("canvas_create_workflow", input, state);
    const second = planTool("canvas_create_workflow", input, state);
    const different = planTool("canvas_create_workflow", { ...input, title: "另一套角色工作流" }, state);
    const nodeIds = (planned: ReturnType<typeof planTool>) => (planned.input.ops as Array<Record<string, unknown>>).filter((op) => op.type === "add_node").map((op) => op.id);
    const runId = (planned: ReturnType<typeof planTool>) => (planned.input.ops as Array<Record<string, unknown>>).find((op) => op.type === "run_generation")?.id;
    assert.deepEqual(nodeIds(first), nodeIds(second));
    assert.equal(runId(first), runId(second));
    assert.notDeepEqual(nodeIds(first), nodeIds(different));
    assert.notEqual(runId(first), runId(different));
});

test("planner rejects a stable high-level request when its derived node id already exists", () => {
    const input = { prompt: "a forest", title: "环境", mode: "image" };
    const emptyState = { nodes: [], connections: [], revision: 3 };
    const planned = planTool("canvas_create_generation_flow", input, emptyState);
    const generatedNode = (planned.input.ops as Array<Record<string, unknown>>).find((op) => op.type === "add_node");
    const stateWithCollision = { ...emptyState, nodes: [{ id: String(generatedNode?.id), type: "text" as const, position: { x: 0, y: 0 }, width: 100, height: 100 }] };
    assert.throws(() => planTool("canvas_create_generation_flow", input, stateWithCollision), /节点 id.*已存在|冲突/);
});

test("planner rejects explicit generation node ids that are empty or reused", () => {
    const state = { nodes: [], connections: [], revision: 3 };
    assert.throws(() => planTool("canvas_create_generation_flow", { prompt: "a forest", textNodeId: "same", targetNodeId: "same" }, state), /复用节点 id/);
    assert.throws(() => planTool("canvas_create_generation_flow", { prompt: "a forest", textNodeId: "" }, state), /显式节点 id 必须是非空字符串/);
});
