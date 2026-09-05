import { describe, expect, test } from "bun:test";

import { calculateNodeAlignment, createNodeAlignmentContext } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, x: number, y: number): CanvasNodeData {
    return { id, type: CanvasNodeType.Text, title: id, position: { x, y }, width: 100, height: 100, metadata: {} };
}

describe("canvas node alignment", () => {
    test("keeps an axis snap stable near the threshold and releases after hysteresis", () => {
        const moving = node("moving", 0, 0);
        const target = node("target", 100, 200);
        const context = createNodeAlignmentContext([moving, target], [{ id: moving.id, x: 0, y: 0 }]);
        expect(context).not.toBeNull();

        const snapped = calculateNodeAlignment(context, { x: 94, y: 0 }, 7);
        expect(snapped.offset.x).toBe(100);
        expect(snapped.guides.vertical).toBe(100);

        const stillSnapped = calculateNodeAlignment(context, { x: 106, y: 0 }, 7, snapped.snapState);
        expect(stillSnapped.offset.x).toBe(100);
        expect(stillSnapped.guides.vertical).toBe(100);

        const released = calculateNodeAlignment(context, { x: 113, y: 0 }, 7, stillSnapped.snapState);
        expect(released.offset.x).toBe(113);
        expect(released.guides.vertical).toBeUndefined();
    });
});
