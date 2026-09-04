package service

import (
	"encoding/json"
	"math"
	"testing"
)

func testMCPSnapshot() MCPCanvasSnapshot {
	return MCPCanvasSnapshot{
		ID: "canvas-1", Title: "测试画布", Nodes: []MCPCanvasNode{
			{ID: "n1", Type: "text", Title: "文本", Position: MCPPosition{X: 0, Y: 0}, Width: 100, Height: 80, Metadata: map[string]any{"content": "hello", "unknown": map[string]any{"keep": true}}},
			{ID: "n2", Type: "image", Title: "图片", Position: MCPPosition{X: 300, Y: 0}, Width: 200, Height: 150, Metadata: map[string]any{"status": "success", "storageKey": "resource:r1"}},
		},
		Connections:     []MCPCanvasConnection{{ID: "c1", FromNodeID: "n1", ToNodeID: "n2", FromHandleID: "out", ToHandleID: "in"}},
		SelectedNodeIDs: []string{"n1"}, Viewport: MCPViewport{X: 0, Y: 0, K: 1},
	}
}

func TestValidateMCPCanvasOpsRejectsInvalidBatch(t *testing.T) {
	snapshot := testMCPSnapshot()
	result := ValidateMCPCanvasOps(snapshot, []MCPCanvasOp{
		{Type: "connect_nodes", FromNodeID: "n1", ToNodeID: "n1"},
		{Type: "add_node", ID: "n1", NodeType: "image", Position: &MCPPosition{X: math.NaN(), Y: 0}, Width: 0, Height: 10001},
		{Type: "update_node", ID: "n2", Metadata: map[string]any{"status": "loading"}},
	})
	if result.OK || len(result.Issues) < 3 {
		t.Fatalf("validation = %#v, want multiple errors", result)
	}
}

func TestApplyMCPCanvasOpsIsAtomicAndCascadesConnections(t *testing.T) {
	snapshot := testMCPSnapshot()
	after, verification, err := ApplyMCPCanvasOps(snapshot, []MCPCanvasOp{
		{Type: "add_node", ID: "n3", NodeType: "script", Title: "脚本", Position: &MCPPosition{X: 0, Y: 200}, Width: 120, Height: 80, Metadata: map[string]any{"custom": "value"}},
		{Type: "connect_nodes", ID: "c2", FromNodeID: "n3", ToNodeID: "n1"},
		{Type: "delete_node", ID: "n2"},
	})
	if err != nil {
		t.Fatalf("ApplyMCPCanvasOps() error = %v", err)
	}
	if len(after.Nodes) != 2 || len(after.Connections) != 1 || after.Connections[0].ID != "c2" {
		t.Fatalf("after = %#v, want n1/n3 and c2 only", after)
	}
	if len(verification.CreatedNodeIDs) != 1 || len(verification.RemovedNodeIDs) != 1 || verification.BeforeHash == verification.AfterHash {
		t.Fatalf("verification = %#v", verification)
	}

	beforeJSON, _ := json.Marshal(snapshot)
	_, _, err = ApplyMCPCanvasOps(snapshot, []MCPCanvasOp{{Type: "delete_node", ID: "n1"}, {Type: "connect_nodes", FromNodeID: "missing", ToNodeID: "n2"}})
	if err == nil {
		t.Fatal("invalid batch unexpectedly succeeded")
	}
	afterJSON, _ := json.Marshal(snapshot)
	if string(beforeJSON) != string(afterJSON) {
		t.Fatal("failed batch mutated input snapshot")
	}
}

func TestDecodeMCPCanvasSnapshotPreservesMetadataAndRejectsDataURL(t *testing.T) {
	good := json.RawMessage(`{"id":"c","title":"x","nodes":[{"id":"n","type":"text","position":{"x":1,"y":2},"width":10,"height":20,"metadata":{"future":{"enabled":true}}}],"connections":[],"viewport":{"x":0,"y":0,"k":1}}`)
	snapshot, err := DecodeMCPCanvasSnapshot(good)
	if err != nil || snapshot.Nodes[0].Metadata["future"] == nil {
		t.Fatalf("decode = %#v, err = %v", snapshot, err)
	}
	if _, err := DecodeMCPCanvasSnapshot(json.RawMessage(`{"nodes":[{"id":"n","type":"image","metadata":{"url":"data:image/png;base64,AA"}}]}`)); err == nil {
		t.Fatal("data URL unexpectedly accepted")
	}
}
