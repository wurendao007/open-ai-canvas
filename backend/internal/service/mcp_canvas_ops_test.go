package service

import (
	"encoding/json"
	"math"
	"strings"
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
	good := json.RawMessage(`{"id":"c","futureTop":{"keep":true},"title":"x","nodes":[{"id":"n","type":"text","futureNode":"keep","position":{"x":1,"y":2},"width":10,"height":20,"metadata":{"future":{"enabled":true}}},{"id":"n2","type":"image","position":{"x":20,"y":2},"width":10,"height":20},{"id":"n3","type":"audio","position":{"x":40,"y":2},"width":10,"height":20}],"connections":[{"id":"edge","fromNodeId":"n","toNodeId":"n2","futureConnection":"keep"},{"id":"edge2","fromNodeId":"n2","toNodeId":"n3"}],"viewport":{"x":0,"y":0,"k":1}}`)
	snapshot, err := DecodeMCPCanvasSnapshot(good)
	if err != nil || snapshot.Nodes[0].Metadata["future"] == nil {
		t.Fatalf("decode = %#v, err = %v", snapshot, err)
	}
	encoded, _ := json.Marshal(snapshot)
	if !json.Valid(encoded) || !jsonContains(encoded, "futureTop") || !jsonContains(encoded, "futureNode") || !jsonContains(encoded, "futureConnection") {
		t.Fatalf("unknown fields were not preserved: %s", encoded)
	}
	if _, err := DecodeMCPCanvasSnapshot(json.RawMessage(`{"nodes":[{"id":"n","type":"image","metadata":{"url":"data:image/png;base64,AA"}}]}`)); err == nil {
		t.Fatal("data URL unexpectedly accepted")
	}
}

func TestDecodeMCPCanvasSnapshotRejectsCorruptStructure(t *testing.T) {
	cases := []string{
		`{"nodes":[{"id":"n","type":"text"},{"id":"n","type":"image"}]}`,
		`{"nodes":[{"id":"n","type":"unknown"}]}`,
		`{"nodes":[{"id":"n","type":"text","width":-1}]}`,
		`{"nodes":[{"id":"n","type":"text"}],"connections":[{"id":"c","fromNodeId":"n","toNodeId":"missing"}]}`,
	}
	for _, raw := range cases {
		if _, err := DecodeMCPCanvasSnapshot(json.RawMessage(raw)); err == nil {
			t.Fatalf("DecodeMCPCanvasSnapshot(%s) unexpectedly succeeded", raw)
		}
	}
}

func TestSanitizeMCPOutputRecursesThroughTypedValues(t *testing.T) {
	type nested struct {
		URL     string            `json:"url"`
		APIKey  string            `json:"api_key"`
		Label   string            `json:"label"`
		Details map[string]string `json:"details"`
	}
	value := SanitizeMCPOutput(nested{URL: "https://private.example", APIKey: "secret", Label: "ok", Details: map[string]string{"authorization": "bearer"}})
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private.example") || strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "bearer") || !strings.Contains(string(encoded), "ok") {
		t.Fatalf("sanitized value = %s", encoded)
	}
}

func TestUpdateNodePatchNumbersAreValidatedAndApplied(t *testing.T) {
	snapshot := testMCPSnapshot()
	validated := ValidateMCPCanvasOps(snapshot, []MCPCanvasOp{{Type: "update_node", ID: "n1", Patch: map[string]any{
		"width": 240, "height": 90, "position": map[string]any{"x": 12, "y": 34},
	}}})
	if !validated.OK {
		t.Fatalf("integer patch unexpectedly rejected: %#v", validated.Issues)
	}
	after, _, err := ApplyMCPCanvasOps(snapshot, []MCPCanvasOp{{Type: "update_node", ID: "n1", Patch: map[string]any{
		"width": 240, "height": 90, "position": map[string]any{"x": 12, "y": 34},
	}}})
	if err != nil {
		t.Fatalf("ApplyMCPCanvasOps() error = %v", err)
	}
	if got := after.Nodes[0]; got.Width != 240 || got.Height != 90 || got.Position != (MCPPosition{X: 12, Y: 34}) {
		t.Fatalf("patched node = %#v", got)
	}
	bad := ValidateMCPCanvasOps(snapshot, []MCPCanvasOp{{Type: "update_node", ID: "n1", Patch: map[string]any{"width": "wide"}}})
	if bad.OK {
		t.Fatal("string width patch unexpectedly accepted")
	}
}

func jsonContains(raw []byte, key string) bool {
	return string(raw) != "" && len(raw) > 0 && strings.Contains(string(raw), key)
}
