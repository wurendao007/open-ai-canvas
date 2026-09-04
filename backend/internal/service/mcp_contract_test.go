package service

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
)

func TestNormalizeCanvasPayloadKeyOrderAndTemporaryFields(t *testing.T) {
	left, err := NormalizeCanvasPayload([]byte(`{"stateHash":"old","nodes":[{"id":"n1"}],"title":"画布","revision":3,"clientId":"browser"}`))
	if err != nil {
		t.Fatal(err)
	}
	right, err := NormalizeCanvasPayload([]byte(`{"clientId":"other","title":"画布","nodes":[{"id":"n1"}],"revision":8,"state_hash":"old"}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(left) != string(right) {
		t.Fatalf("normalized payloads differ: %s != %s", left, right)
	}
}

func TestCanvasStateHashChangesWhenNodeChanges(t *testing.T) {
	left, err := CanvasStateHash([]byte(`{"nodes":[{"id":"n1","title":"A"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	right, err := CanvasStateHash([]byte(`{"nodes":[{"id":"n1","title":"B"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if left == right || len(left) != 43 || strings.ContainsAny(left, "+/=") {
		t.Fatalf("unexpected hashes: %q and %q", left, right)
	}
}

func TestNormalizeCanvasPayloadRejectsInvalidJSONArraysAndInlineMedia(t *testing.T) {
	tests := []string{
		`{"nodes":`,
		`[]`,
		`{"nodes":[{"data":"data:image/png;base64,AAAA"}]}`,
	}
	for _, raw := range tests {
		if _, err := NormalizeCanvasPayload([]byte(raw)); err == nil {
			t.Fatalf("expected rejection for %s", raw)
		}
	}
}

func TestMCPContractPayloadRemainsJSON(t *testing.T) {
	project := CanvasMCPProject{ID: "canvas-1", Payload: json.RawMessage(`{"nodes":[]}`), Revision: 0, StateHash: "hash"}
	encoded, err := json.Marshal(project)
	if err != nil {
		t.Fatal(err)
	}
	var decoded CanvasMCPProject
	if err := json.Unmarshal(encoded, &decoded); err != nil || string(decoded.Payload) != `{"nodes":[]}` {
		t.Fatalf("payload was not round-trippable: %s (%v)", encoded, err)
	}
}

func TestMCPModelMigrationDefaults(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-contract-migration?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	legacy := model.CanvasProject{
		ID:          "canvas-migration",
		UserID:      "user-1",
		PayloadJSON: `{"revision":12,"nodes":[{"id":"n1"}],"stateHash":"legacy"}`,
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var migrated model.CanvasProject
	if err := db.First(&migrated, "id = ?", legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	wantHash, err := CanvasStateHash([]byte(legacy.PayloadJSON))
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Revision != 0 || migrated.StateHash != wantHash || migrated.PayloadJSON != legacy.PayloadJSON {
		t.Fatalf("migration result = revision %d hash %q payload %s", migrated.Revision, migrated.StateHash, migrated.PayloadJSON)
	}
	registered := map[string]bool{}
	for _, item := range database.Models() {
		switch item.(type) {
		case *model.MCPDeviceSession:
			registered["device"] = true
		case *model.MCPToken:
			registered["token"] = true
		}
	}
	if !registered["device"] || !registered["token"] {
		t.Fatalf("MCP models are not registered in database.Models: %#v", registered)
	}
}
