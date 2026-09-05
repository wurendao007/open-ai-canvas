import { describe, expect, test } from "bun:test";

import { parseCanvasStorageDocument } from "@/lib/canvas/canvas-storage-revision";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

function projectWithLegacyPortraitNode() {
    const portraitNode: CanvasNodeData = {
        id: "portrait",
        type: "portrait-clearance",
        title: "旧肖像核验",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { portraitClearance: { status: "pending" } } as CanvasNodeData["metadata"],
    };
    const imageNode: CanvasNodeData = {
        id: "image",
        type: CanvasNodeType.Image,
        title: "保留节点",
        position: { x: 400, y: 0 },
        width: 320,
        height: 240,
        metadata: { content: "image-url", portraitClearance: { stale: true } } as CanvasNodeData["metadata"],
    };
    const project = {
        id: "project",
        title: "旧项目",
        nodes: [portraitNode, imageNode],
        connections: [
            { id: "to-portrait", fromNodeId: "image", toNodeId: "portrait" },
            { id: "from-portrait", fromNodeId: "portrait", toNodeId: "image" },
            { id: "keep", fromNodeId: "image", toNodeId: "image" },
        ],
        selectedNodeIds: ["portrait", "image"],
    } as unknown as CanvasProject & { selectedNodeIds: string[] };
    return project;
}

describe("canvas storage legacy normalization", () => {
    test("移除旧 portrait-clearance 节点、相关连线和选区，并清除遗留 metadata", () => {
        const project = projectWithLegacyPortraitNode();
        const value = JSON.stringify({ state: { projects: [project] }, version: 1, storageRevision: 2 });

        const parsed = parseCanvasStorageDocument(value);
        const normalized = parsed.state.projects[0] as CanvasProject & { selectedNodeIds?: string[] };

        expect(normalized.nodes.map((node) => node.id)).toEqual(["image"]);
        expect(normalized.connections.map((connection) => connection.id)).toEqual(["keep"]);
        expect(normalized.selectedNodeIds).toEqual(["image"]);
        expect(normalized.nodes[0]?.metadata).not.toHaveProperty("portraitClearance");
    });
});
