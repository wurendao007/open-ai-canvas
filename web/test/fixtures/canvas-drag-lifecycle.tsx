// Browser regression fixture: open through the Vite development server.
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useCanvasSelectionController } from "../../src/pages/canvas/use-canvas-selection-controller";
import { subscribeCanvasNodeDragPreview, type CanvasNodeDragPreview } from "../../src/lib/canvas/canvas-live-viewport";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => {};
const nodes: CanvasNodeData[] = [
    { id: "moving", type: CanvasNodeType.Text, title: "Moving", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} },
    { id: "target", type: CanvasNodeType.Text, title: "Target", position: { x: 100, y: 200 }, width: 100, height: 100, metadata: {} },
];
const root = createRoot(document.getElementById("root")!);
let rerender: () => void;
let endCalls = 0;
let latestRender = -1;

function Fixture() {
    const [revision, setRevision] = useState(0);
    rerender = () => setRevision((n) => n + 1);
    const [currentNodes, setNodes] = useState(nodes);
    const containerRef = useRef<HTMLDivElement>(null);
    const nodesRef = useRef(currentNodes);
    nodesRef.current = currentNodes;
    const viewportRef = useRef({ x: 0, y: 0, k: 1 });
    const selectedNodeIdsRef = useRef(new Set<string>());
    const historyPausedRef = useRef(false);
    const controller = useCanvasSelectionController({
        containerRef, nodesRef, viewportRef, selectedNodeIdsRef, historyPausedRef,
        screenToCanvas: (x, y) => ({ x, y }), setNodes,
        setSelectedNodeIds: noop, setSelectedConnectionId: noop,
        cancelPendingConnectionCreate: noop, onCanvasSelectionStart: noop,
        onNodeInteractionStart: noop, onNodeClick: noop, onDeselect: noop,
        // Match the project's inline callback and exercise other changing handlers.
        onSelectionBoxEnd: () => {},
        onNodeDragEnd: () => { endCalls++; latestRender = revision; },
    });
    return <div ref={containerRef} id="canvas">
        <div data-node-id="moving" onMouseDown={(event) => controller.handleNodeMouseDown(event, "moving")}
            style={{ width: 100, height: 100, background: "lightblue", transform: `translate(${currentNodes[0].position.x}px, ${currentNodes[0].position.y}px)` }}>Moving</div>
        <output id="guides">{JSON.stringify(controller.alignmentGuides)}</output>
    </div>;
}

function assert(value: unknown, message: string) {
    if (!value) throw new Error(message);
}

document.getElementById("run")!.onclick = async () => {
    (document.getElementById("run") as HTMLButtonElement).disabled = true;
    const result = document.getElementById("result")!;
    let unsubscribe = noop;
    try {
        await act(async () => root.render(<Fixture />));
        const container = document.getElementById("canvas") as HTMLDivElement;
        const moving = container.querySelector<HTMLElement>("[data-node-id='moving']")!;
        const previews: Array<CanvasNodeDragPreview | null> = [];
        const previewStyles: Array<{ translate: string; value: string; style: string }> = [];
        unsubscribe = subscribeCanvasNodeDragPreview(container, (preview) => {
            previews.push(preview);
            previewStyles.push({ translate: moving.style.translate, value: moving.style.getPropertyValue("translate"), style: moving.getAttribute("style") || "" });
        });
        await act(async () => moving.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })));
        previews.length = 0;
        const move = async (x: number, y: number) => {
            await act(async () => {
                window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, buttons: 1 }));
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            });
        };
        await move(94, 194);
        assert(moving.style.getPropertyValue("translate") === "100px 200px", `对齐重渲染后节点位移丢失: '${moving.style.translate}', value='${moving.style.getPropertyValue("translate")}', style='${moving.getAttribute("style")}', previews=${previews.length}, previewStyles=${JSON.stringify(previewStyles)}`);
        assert(!previews.includes(null), "对齐重渲染错误地通知连接线清除预览");
        await move(106, 206);
        assert(moving.style.translate === "100px 200px", "吸附边界位移不稳定");
        await act(async () => rerender());
        assert(moving.style.translate === "100px 200px", "父层重渲染清除了拖动预览");
        assert(!previews.includes(null), "父层重渲染清除了连接线预览");
        await move(130, 230);
        assert(moving.style.translate === "130px 230px", "解除吸附后未继续拖动");
        assert(previews.at(-1)?.x === 130 && previews.at(-1)?.y === 230, "连接线未收到相同偏移");
        await act(async () => window.dispatchEvent(new MouseEvent("mouseup", { clientX: 130, clientY: 230 })));
        assert(moving.style.translate === "", "松手后未清理位移");
        assert(moving.style.transform === "translate(130px, 230px)", "松手后未提交位置");
        assert(endCalls === 1 && latestRender === 1, "结束回调没有使用最新 render");
        await act(async () => moving.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 130, clientY: 230 })));
        await act(async () => {
            window.dispatchEvent(new PointerEvent("pointermove", { clientX: 180, clientY: 280, buttons: 1 }));
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        assert(moving.style.translate === "50px 50px", "第二次拖动的 pointermove 无效");
        await act(async () => window.dispatchEvent(new PointerEvent("pointercancel")));
        assert(moving.style.translate === "", "取消拖动后未清理预览");
        await act(async () => moving.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 130, clientY: 230 })));
        await move(180, 280);
        await act(async () => root.unmount());
        assert(moving.style.translate === "" && previews.at(-1) === null, "卸载未清理节点与连接线预览");
        const countAfterUnmount = previews.length;
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 250, clientY: 350, buttons: 1 }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        assert(previews.length === countAfterUnmount, "卸载后仍有拖动监听或动画帧");
        result.textContent = "PASS: XY 吸附、边界移动、父层重渲染、解除吸附、节点与连接线预览、松手提交、最新回调、再次拖动、pointercancel、拖动中卸载清理。";
    } catch (error) {
        result.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        unsubscribe();
    }
};
