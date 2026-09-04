import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteCanvasEnvelope, RemoteCanvasPrecondition, RemoteCanvasProject } from "../src/remote-contract.js";

test("remote contract", () => {
    const precondition: RemoteCanvasPrecondition = { revision: 0, stateHash: "state-hash" };
    const project: RemoteCanvasProject = {
        id: "canvas-1",
        title: "画布",
        payload: { nodes: [] },
        revision: precondition.revision,
        stateHash: precondition.stateHash,
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:00:00.000Z",
    };
    const envelope: RemoteCanvasEnvelope<RemoteCanvasProject> = { code: 0, data: project, msg: "" };
    assert.equal(envelope.data.revision, 0);
    assert.deepEqual(envelope.data.payload, { nodes: [] });
});
