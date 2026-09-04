package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

func newMCPProjectTestService(t *testing.T, name string) (*Service, *repository.Repository, *gorm.DB) {
	t.Helper()
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-canvas-" + name + "-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Asset{}, &model.CanvasProject{}, &model.CanvasShare{}, &model.CanvasUnitLink{}, &model.Session{}, &model.Message{}, &model.Task{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}, &model.UserDailyActivity{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	return New(repo, t.TempDir()), repo, db
}

func paddedCanvasPayload(id string, title string, pad int) json.RawMessage {
	return json.RawMessage(`{"id":"` + id + `","title":"` + title + `","nodes":[],"connections":[],"pad":"` + strings.Repeat("x", pad) + `"}`)
}

func TestSaveCanvasProjectWithPreconditionIncrementsVersion(t *testing.T) {
	svc, _, _ := newMCPProjectTestService(t, "project")
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
	svc, r, _ := newMCPProjectTestService(t, "list")
	stateHash, err := model.CanvasStateHash([]byte(`{"id":"canvas-1","title":"列表","nodes":[],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Create(&model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: "project-1", Title: "列表", PayloadJSON: `{"id":"canvas-1","title":"列表","nodes":[],"connections":[]}`, Revision: 4, StateHash: stateHash}); err != nil {
		t.Fatal(err)
	}
	projects, err := svc.ListMCPProjects("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].Revision != 4 || projects[0].StateHash != stateHash || projects[0].HashSource != "server" {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestSaveCanvasProjectRejectsStaleHashWithoutChangingStoredProject(t *testing.T) {
	svc, _, _ := newMCPProjectTestService(t, "hash")
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
	svc, _, _ := newMCPProjectTestService(t, "scope")
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
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-2", other, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected scoped stale precondition to fail for missing user-2 row")
	}
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-2", other, nil); err != nil {
		t.Fatal(err)
	}
}

func TestSaveCanvasProjectWithPreconditionMissingRowDoesNotRecreate(t *testing.T) {
	svc, repo, _ := newMCPProjectTestService(t, "missing")
	raw := json.RawMessage(`{"id":"canvas-1","title":"初稿","nodes":[],"connections":[]}`)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteCanvasProject("user-1", "canvas-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", raw, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected missing row conflict")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusConflict {
			t.Fatalf("missing row error = %v", err)
		}
	}
	if _, err := svc.GetMCPProject("user-1", "canvas-1"); err == nil {
		t.Fatal("stale precondition recreated deleted canvas")
	}
}

func TestSaveCanvasProjectWithPreconditionChecksQuotaAndRecordsActivity(t *testing.T) {
	svc, repo, db := newMCPProjectTestService(t, "quota")
	policy := defaultRuntimePolicy()
	policy.Resource.StructuredDataMB = 1
	rawPolicy, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(rawPolicy)}); err != nil {
		t.Fatal(err)
	}
	base := paddedCanvasPayload("canvas-1", "初稿", 512*1024)
	first, err := svc.SaveCanvasProjectWithPrecondition("user-1", base, nil)
	if err != nil {
		t.Fatal(err)
	}
	var activity model.UserDailyActivity
	if err := db.First(&activity, "user_id = ?", "user-1").Error; err != nil || !activity.CanvasActive {
		t.Fatalf("activity = %#v err=%v", activity, err)
	}
	oversized := paddedCanvasPayload("canvas-1", "超额", 1100*1024)
	if _, err := svc.SaveCanvasProjectWithPrecondition("user-1", oversized, &CanvasMCPPrecondition{Revision: first.Revision, StateHash: first.StateHash}); err == nil {
		t.Fatal("expected quota error")
	}
	stored, err := svc.GetMCPProject("user-1", "canvas-1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != first.Revision || string(stored.Payload) != string(base) {
		t.Fatalf("stored after quota rejection = %#v", stored)
	}
}

func TestCanvasProjectSummarySerializesRevisionZeroAndStateHash(t *testing.T) {
	raw, err := json.Marshal(UserDataSummary{ID: "canvas-1", Title: "初稿", StateHash: "hash-r0"})
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if !strings.Contains(body, `"revision":0`) {
		t.Fatalf("revision zero omitted: %s", body)
	}
	if !strings.Contains(body, `"stateHash":"hash-r0"`) {
		t.Fatalf("state hash omitted: %s", body)
	}
}
