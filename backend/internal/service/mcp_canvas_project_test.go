package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestSaveCanvasProjectWithPreconditionIncrementsVersion(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-canvas-project-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	raw := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != 0 || first.StateHash == "" {
		t.Fatalf("first = %#v", first)
	}
	if first.HashSource != "server" {
		t.Fatalf("first hash source = %q", first.HashSource)
	}
	updatedRaw := json.RawMessage(`{"id":"canvas-1","title":"二稿","nodes":[],"connections":[]}`)
	second, err := svc.SaveCanvasProjectWithPrecondition("user-1", updatedRaw, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash})
	if err != nil {
		t.Fatal(err)
	}
	if second.Revision != 1 || second.StateHash == first.StateHash {
		t.Fatalf("second = %#v", second)
	}
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected stale precondition conflict")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusConflict || appErr.Message != "画布已被其他窗口或 MCP 修改，请重新加载/合并" {
			t.Fatalf("stale error = %v", err)
		}
	}
}

func TestListMCPProjectsReturnsServerVersionMetadata(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-canvas-list-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	r := repository.New(db)
	stateHash, err := model.CanvasStateHash([]byte(`{"id":"canvas-1","title":"列表","nodes":[],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: "project-1", Title: "列表", PayloadJSON: `{"id":"canvas-1","title":"列表","nodes":[],"connections":[]}`, Revision: 4, StateHash: stateHash}).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(r, t.TempDir())
	projects, err := svc.ListMCPProjects("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].Revision != 4 || projects[0].StateHash != stateHash || projects[0].HashSource != "server" {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestSaveCanvasProjectRejectsStaleHashWithoutChangingStoredProject(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-canvas-hash-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	base := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", base, nil)
	if err != nil {
		t.Fatal(err)
	}
	changed := json.RawMessage(`{"id":"canvas-1","title":"不应写入","nodes":[],"connections":[]}`)
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", changed, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: "wrong-hash"}); err == nil {
		t.Fatal("expected stale hash conflict")
	}
	stored, err := svc.GetMCPProject("user-1", "canvas-1")
	if err != nil {
		t.Fatal(err)
	}
	if string(stored.Payload) != string(base) || stored.Revision != first.Revision || stored.StateHash != first.StateHash {
		t.Fatalf("stored = %#v", stored)
	}
}

func TestSaveCanvasProjectPreconditionIsUserScoped(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-canvas-scope-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	raw := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetMCPProject("user-2", "canvas-1"); err == nil {
		t.Fatal("expected user-scoped project lookup to fail")
	}
	if _, err := svc.ListMCPProjects("user-2"); err != nil {
		t.Fatal(err)
	}
	other := json.RawMessage(`{"id":"canvas-2","title":"其他用户","nodes":[],"connections":[]}`)
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-2", other, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err != nil {
		t.Fatal(err)
	}
}
