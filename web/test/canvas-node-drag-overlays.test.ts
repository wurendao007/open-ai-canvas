import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const projectSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const selectionControllerSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-selection-controller.ts"), "utf8");
const liveViewportSource = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/canvas-live-viewport.ts"), "utf8");
const leaferGraphicsSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-leafer-graphics-layer.tsx"), "utf8");
const worldLayersSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/canvas-project-world-layers.tsx"), "utf8");
const canvasNodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
const canvasFrameNodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-frame-node.tsx"), "utf8");

describe("canvas node drag overlays", () => {
    test("hides floating editors and selection controls for the whole drag preview", () => {
        expect(projectSource).toContain("const isCanvasNodeMoving = isNodeDragging || Boolean(dragPreview?.nodeIds.size);");
        expect(projectSource).toContain("dialogNode.type !== CanvasNodeType.Drawing && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("angleNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("emotionNode?.metadata?.content && !isCanvasNodeMoving");
        expect(projectSource).toContain("selectedNodeBounds && !selectionBox && !isCanvasNodeMoving");
        expect(projectSource).toContain("node={isCanvasNodeMoving || nodeImageSettingsOpen || emotionNodeId ? null : toolbarNode}");
        expect(projectSource).toContain("onNodeDragEnd: handleNodeDragEnd");
        expect(projectSource).toContain("setDialogNodeId(node.id);");
        expect(selectionControllerSource).toContain("if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);");
        const commitIndex = selectionControllerSource.indexOf("setNodes(linkedFolder ? positioned : applyFrameDrop(positioned, draggedNodeIds, targetId));");
        const clearIndex = selectionControllerSource.indexOf("dragPreviewClearPendingRef.current = true;");
        expect(commitIndex).toBeGreaterThan(-1);
        expect(clearIndex).toBeGreaterThan(commitIndex);
    });

    test("keeps node and connection previews on one continuous compositor path", () => {
        expect(liveViewportSource).toContain("const nextIds = preview?.nodeIds || null;");
        expect(liveViewportSource).toContain("new MutationObserver");
        expect(liveViewportSource).toContain("active.nodeIds.has(nodeId)");
        expect(liveViewportSource).toContain("if (!nextIds?.has(nodeId)) state.elementsById.get(nodeId)?.style.removeProperty(\"translate\");");
        expect(liveViewportSource).toContain("element.style.setProperty(\"translate\", `${preview.x}px ${preview.y}px`);");
        expect(selectionControllerSource).not.toContain("setDragPreview((current) => current ? { ...current, x: latest.x, y: latest.y } : current);");
        expect(selectionControllerSource).toContain("applyCanvasAlignmentGuidesPreview(containerRef.current, nextGuides);");
        expect(selectionControllerSource).not.toContain("setAlignmentGuides((current) => current.vertical === nextGuides.vertical");
        expect(leaferGraphicsSource).toContain("subscribeCanvasNodeDragPreview");
        expect(leaferGraphicsSource).toContain("const unsubscribeNodeDrag = subscribeCanvasNodeDragPreview");
        expect(leaferGraphicsSource).toContain("subscribeCanvasAlignmentGuidesPreview");
        expect(leaferGraphicsSource).toContain("syncOverlayGuides(overlay, rasterViewportRef.current, rect.width, rect.height, props.theme, props.alignmentGuides);");
        expect(leaferGraphicsSource).toContain("function syncOverlayGuides(");
        expect(leaferGraphicsSource).not.toContain("syncViewport(rasterViewportRef.current, rect.width, rect.height, underlay, overlay, props);\n        if (isViewportPreview");
        expect(worldLayersSource).toContain("isDragging={Boolean(props.dragPreview?.nodeIds.has(node.id))}");
        expect(canvasNodeSource).toContain("data.position.x + (dragOffset?.x || 0)");
        expect(canvasFrameNodeSource).toContain("data.position.x + (dragOffset?.x || 0)");
    });
});
