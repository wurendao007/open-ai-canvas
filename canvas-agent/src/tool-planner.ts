import crypto from "node:crypto";
import type { CanvasNodeType, CanvasSnapshot } from "./types.js";
import type { ToolName } from "./schemas.js";
import { nextCanvasX } from "./tools.js";

export type PlannedTool = { tool: "read" | "validate" | "apply" | "generate"; input: Record<string, unknown> };

export function planTool(name: ToolName, raw: Record<string, unknown>, state: CanvasSnapshot): PlannedTool {
    let input = { ...raw };
    if (name.startsWith("project_")) throw new Error("项目业务工具尚未开放在线 MCP 接口");
    if (["canvas_get_state", "canvas_get_context", "canvas_find_nodes", "canvas_get_node", "canvas_get_connection", "canvas_get_generation_tasks", "canvas_get_resources", "canvas_get_selection", "canvas_export_snapshot"].includes(name)) return { tool: "read", input };
    if (name === "canvas_validate_ops") return { tool: "validate", input };
    if (name === "canvas_apply_ops") return { tool: "apply", input };
    if (name === "canvas_create_workflow") input = { ...input, ops: workflowOps(input, state) };
    else if (name === "canvas_create_node") {
        const d = input as { nodeType: CanvasNodeType; title?: string; x?: number; y?: number; width?: number; height?: number; metadata?: Record<string, unknown> };
        input = { ops: [{ type: "add_node", nodeType: d.nodeType, title: d.title, position: { x: d.x ?? nextCanvasX(state), y: d.y ?? 0 }, width: d.width, height: d.height, metadata: d.metadata }] };
    } else if (name === "canvas_create_text_node") {
        const d = input as { text?: string; title?: string; x?: number; y?: number; width?: number; height?: number };
        input = { ops: [textOp(d, d.x ?? nextCanvasX(state), d.y ?? 0)] };
    } else if (name === "canvas_create_text_nodes") {
        const d = input as { items: Array<{ text: string; title?: string; x?: number; y?: number; width?: number; height?: number }>; x?: number; y?: number; gap?: number; direction?: "row" | "column" };
        const x = d.x ?? nextCanvasX(state), y = d.y ?? 0, gap = d.gap ?? 40;
        input = { ops: d.items.map((item, i) => textOp(item, item.x ?? (d.direction === "row" ? x + i * (340 + gap) : x), item.y ?? (d.direction === "row" ? y : y + i * (240 + gap)))) };
    } else if (name === "canvas_create_image_prompt_flow" || name === "canvas_create_generation_flow") {
        input = { ...input, ops: generationFlow(input, state, name === "canvas_create_image_prompt_flow" ? "image" : undefined) };
    } else if (name.startsWith("canvas_generate_")) {
        input = { ...input, ops: generationFlow({ ...input, autoRun: true }, state, name.replace("canvas_generate_", "")) };
    } else if (name === "canvas_update_node") {
        const d = input as { id: string; patch?: Record<string, unknown>; metadata?: Record<string, unknown> };
        input = { ops: [{ type: "update_node", id: d.id, patch: d.patch, metadata: d.metadata }] };
    } else if (name === "canvas_update_node_text") {
        const d = input as { id: string; text: string; title?: string };
        input = { ops: [{ type: "update_node", id: d.id, patch: d.title ? { title: d.title } : {}, metadata: { content: d.text, status: "success" } }] };
    } else if (name === "canvas_move_nodes") {
        const d = input as { items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> };
        input = { ops: d.items.map((item) => { const node = state.nodes?.find((n) => n.id === item.id); return { type: "update_node", id: item.id, patch: { position: { x: item.x ?? ((node?.position.x || 0) + (item.dx || 0)), y: item.y ?? ((node?.position.y || 0) + (item.dy || 0)) } } }; }) };
    } else if (name === "canvas_resize_node") {
        const d = input as { id: string; width: number; height: number; freeResize?: boolean };
        input = { ops: [{ type: "update_node", id: d.id, patch: { width: d.width, height: d.height }, metadata: d.freeResize === undefined ? undefined : { freeResize: d.freeResize } }] };
    } else if (name === "canvas_delete_nodes") input = { ops: [{ type: "delete_node", ids: (input as { ids: string[] }).ids }] };
    else if (name === "canvas_connect_nodes") input = { ops: (input as { connections: Array<Record<string, unknown>> }).connections.map((value) => ({ type: "connect_nodes", ...value })) };
    else if (name === "canvas_select_nodes") input = { ops: [{ type: "select_nodes", ids: (input as { ids: string[] }).ids }] };
    else if (name === "canvas_set_viewport") input = { ops: [{ type: "set_viewport", viewport: (input as { viewport: unknown }).viewport }] };
    else if (name === "canvas_run_generation") {
        const d = input as { nodeId: string; mode?: string; prompt?: string; retry?: boolean; clientOperationId?: string; idempotencyKey?: string };
        const identity = d.idempotencyKey || d.clientOperationId || stableGenerationIdentity(d);
        return { tool: "generate", input: { nodeId: d.nodeId, mode: d.mode || "image", prompt: d.prompt || "", retry: d.retry, clientOperationId: identity, ...(d.idempotencyKey ? { idempotencyKey: d.idempotencyKey } : {}), ...(preconditions(raw)) } };
    } else throw new Error(`未知工具：${name}`);
    return { tool: "apply", input: { ...input, ...preconditions(raw) } };
}

function preconditions(input: Record<string, unknown>) { return { ...(typeof input.expectedRevision === "number" ? { expectedRevision: input.expectedRevision } : {}), ...(typeof input.expectedStateHash === "string" ? { expectedStateHash: input.expectedStateHash } : {}) }; }
function stableGenerationIdentity(input: { nodeId: string; mode?: string; prompt?: string; retry?: boolean }) { return `canvas-generation-${crypto.createHash("sha256").update(JSON.stringify({ nodeId: input.nodeId, mode: input.mode || "image", prompt: input.prompt || "", retry: input.retry === true })).digest("hex").slice(0, 48)}`; }
function textOp(d: { id?: string; text?: string; title?: string; width?: number; height?: number }, x: number, y: number) { return { type: "add_node", id: d.id, nodeType: "text", title: d.title, position: { x, y }, width: d.width, height: d.height, metadata: { content: d.text || "", status: "success", fontSize: 14 } }; }

function generationFlow(input: Record<string, unknown>, state: CanvasSnapshot, forcedMode?: string) {
    const mode = forcedMode || generationMode(input.mode), prompt = String(input.prompt || ""), x = Number(input.x ?? nextCanvasX(state)), y = Number(input.y ?? 0);
    const textId = `text-${crypto.randomUUID()}`, targetId = `${mode}-${crypto.randomUUID()}`;
    const references = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const tokens = [`@[node:${textId}]`, ...references.map((id) => `@[node:${id}]`)], targetPrompt = tokens.join("\n");
    return [textOp({ id: textId, text: prompt, title: String(input.title || "提示词") }, x, y), generationTargetNodeOp(targetId, { ...input, mode, prompt: targetPrompt }, x + 420, y), { type: "connect_nodes", fromNodeId: textId, toNodeId: targetId }, ...references.map((fromNodeId) => ({ type: "connect_nodes", fromNodeId, toNodeId: targetId })), { type: "select_nodes", ids: [targetId] }, ...(input.autoRun ? [{ type: "run_generation", id: `generation-${crypto.randomUUID()}`, nodeId: targetId, mode, prompt: targetPrompt }] : [])];
}

function generationTargetNodeOp(id: string, input: Record<string, unknown>, x: number, y: number) {
    const mode = generationMode(input.mode), nodeType = generationNodeType(mode), prompt = String(input.prompt || "");
    return { type: "add_node", id, nodeType, title: String(input.title || generationTitle(mode)), position: { x, y }, width: typeof input.width === "number" ? input.width : undefined, height: typeof input.height === "number" ? input.height : undefined, metadata: cleanRecord({ content: "", fontSize: nodeType === "text" ? 14 : undefined, generationMode: mode, composerContent: prompt, prompt, status: "idle", model: input.model, size: input.size, quality: input.quality, count: input.count, seconds: input.seconds, vquality: input.vquality, generateAudio: input.generateAudio, watermark: input.watermark, audioVoice: input.audioVoice, audioFormat: input.audioFormat, audioSpeed: input.audioSpeed, audioInstructions: input.audioInstructions }) };
}

function workflowOps(input: Record<string, unknown>, state: CanvasSnapshot) {
    const nodes = Array.isArray(input.nodes) ? input.nodes as Array<Record<string, unknown>> : [];
    if (!nodes.length) throw new Error("工作流至少需要一个节点");
    const refs = new Set<string>();
    for (const node of nodes) {
        const ref = String(node.ref || "").trim(), title = String(node.title || "").trim(), kind = String(node.kind || "text"), prompt = String(node.prompt || node.content || workflowPrompt(kind, title, input)).trim();
        if (!ref || !title) throw new Error("工作流节点必须包含 ref 和 title");
        if (refs.has(ref)) throw new Error(`工作流节点 ref「${ref}」重复`);
        if (!["text", "script"].includes(workflowNodeType(kind)) && !prompt) throw new Error(`媒体工作流节点「${title}」缺少 prompt/content，不能创建空资源节点`);
        refs.add(ref);
        for (const nodeId of Array.isArray(node.referenceNodeIds) ? node.referenceNodeIds : []) if (!state.nodes?.some((candidate) => candidate.id === String(nodeId))) throw new Error(`节点「${title}」引用的现有节点「${String(nodeId)}」不存在`);
    }
    const direction = input.direction === "vertical" ? "vertical" : "horizontal", gap = Math.max(48, Number(input.gap || 120)), existing = state.nodes || [];
    const maxX = existing.reduce((max, node) => Math.max(max, node.position.x + node.width), 0), maxY = existing.reduce((max, node) => Math.max(max, node.position.y + node.height), 0);
    const start = input.start && typeof input.start === "object" ? input.start as { x: number; y: number } : { x: existing.length ? maxX + 160 : 80, y: existing.length ? Math.max(80, maxY - 520) : 80 };
    const ids = new Map(nodes.map((node) => [String(node.ref), `agent-workflow-${slug(String(node.ref))}-${crypto.randomUUID().slice(0, 8)}`]));
    const ops: Array<Record<string, unknown>> = [];
    let cursor = { x: Number(start.x), y: Number(start.y) };
    for (const node of nodes) {
        const kind = String(node.kind || "text"), type = workflowNodeType(kind), size = workflowNodeSize(type, node.width, node.height), prompt = String(node.prompt || node.content || workflowPrompt(kind, String(node.title), input));
        const internalReferences = Array.isArray(node.referenceRefs) ? node.referenceRefs.map((ref) => ids.get(String(ref))).filter((value): value is string => Boolean(value)) : [];
        const externalReferences = Array.isArray(node.referenceNodeIds) ? node.referenceNodeIds.map(String) : [], allReferences = [...internalReferences, ...externalReferences];
        ops.push({ type: "add_node", id: ids.get(String(node.ref)), nodeType: type, title: String(node.title), position: { ...cursor }, width: size.width, height: size.height, metadata: cleanRecord({ content: type === "text" ? String(node.content || prompt) : "", composerContent: prompt, prompt, workflowKind: workflowKind(kind), workflowTitle: input.title, workflowDescription: node.description || input.description, generationMode: type === "image" || type === "video" || type === "audio" ? type : undefined, status: type === "text" || type === "script" ? "success" : "idle", referenceNodeIds: allReferences.length ? allReferences : undefined }) });
        cursor = direction === "vertical" ? { x: Number(start.x), y: cursor.y + size.height + gap } : { x: cursor.x + size.width + gap, y: Number(start.y) };
    }
    const edges = Array.isArray(input.edges) && input.edges.length ? input.edges as Array<Record<string, unknown>> : nodes.slice(0, -1).map((node, index) => ({ from: node.ref, to: nodes[index + 1].ref }));
    const keys = new Set<string>();
    const addConnection = (from: string, to: string) => { const key = `${from}\0${to}`; if (!keys.has(key)) { keys.add(key); ops.push({ type: "connect_nodes", fromNodeId: from, toNodeId: to }); } };
    for (const edge of edges) { const from = String(edge.from || ""), to = String(edge.to || ""); if (!ids.has(from) || !ids.has(to)) throw new Error(`工作流连线引用不存在的节点：${from} → ${to}`); addConnection(ids.get(from) as string, ids.get(to) as string); }
    for (const node of nodes) for (const ref of Array.isArray(node.referenceRefs) ? node.referenceRefs : []) { const from = String(ref), to = String(node.ref); if (!ids.has(from)) throw new Error(`节点「${to}」引用了不存在的节点「${from}」`); addConnection(ids.get(from) as string, ids.get(to) as string); }
    for (const node of nodes) for (const ref of Array.isArray(node.referenceNodeIds) ? node.referenceNodeIds : []) addConnection(String(ref), ids.get(String(node.ref)) as string);
    ops.push({ type: "select_nodes", ids: nodes.map((node) => ids.get(String(node.ref))) });
    if (input.autoRun === true || nodes.some((node) => node.runGeneration === true)) for (const node of nodes) {
        const type = workflowNodeType(String(node.kind || "text"));
        if (!["image", "video", "audio"].includes(type) || (input.autoRun !== true && node.runGeneration !== true)) continue;
        ops.push({ type: "run_generation", id: `generation-${crypto.randomUUID()}`, nodeId: ids.get(String(node.ref)), mode: type, prompt: String(node.prompt || node.content || workflowPrompt(String(node.kind || "text"), String(node.title), input)) });
    }
    return ops;
}

function workflowNodeType(kind: string): CanvasNodeType { if (kind === "script") return "script"; if (["image", "character_cards", "character_three_view"].includes(kind)) return "image"; if (["video", "storyboard_video"].includes(kind)) return "video"; if (kind === "audio") return "audio"; return "text"; }
function workflowNodeSize(type: CanvasNodeType, width: unknown, height: unknown) { const defaults = type === "image" ? { width: 560, height: 380 } : type === "video" ? { width: 640, height: 360 } : type === "script" ? { width: 920, height: 360 } : type === "audio" ? { width: 340, height: 160 } : { width: 420, height: 240 }; return { width: typeof width === "number" && width > 0 ? width : defaults.width, height: typeof height === "number" && height > 0 ? height : defaults.height }; }
function workflowPrompt(kind: string, title: string, input: Record<string, unknown>) { const workflowTitle = String(input.title || input.description || "当前创作项目").trim(); if (kind === "character_cards") return `请基于「${workflowTitle}」拆分主要角色，并为每个角色生成可用于后续创作的角色图片卡片：外观、服饰、身份、性格和视觉辨识点。`; if (kind === "character_three_view") return `请基于上游角色卡片生成「${title}」：同一角色的正面、侧面、背面三视图，保持服饰、发型、道具和比例一致。`; if (kind === "storyboard_video") return `请基于上游角色三视图，为「${workflowTitle}」制作分镜剧情视频方案：包含镜头顺序、景别、动作、节奏和画面连续性。`; return ""; }
function workflowKind(kind: string) { if (["character_cards", "character_three_view"].includes(kind)) return "character"; if (kind === "storyboard_video") return "storyboard"; if (kind === "script") return "script"; return "free"; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "node"; }
function generationNodeType(mode: string): CanvasNodeType { if (mode === "text") return "text"; if (mode === "video") return "video"; if (mode === "audio") return "audio"; return "image"; }
function generationMode(value: unknown): "text" | "image" | "video" | "audio" { return value === "text" || value === "video" || value === "audio" ? value : "image"; }
function generationTitle(mode: string) { if (mode === "text") return "文本生成"; if (mode === "video") return "视频生成"; if (mode === "audio") return "音频生成"; return "图片生成"; }
function cleanRecord(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")); }
