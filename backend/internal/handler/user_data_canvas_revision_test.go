package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func newCanvasRevisionHandlerTest(t *testing.T) (*gin.Engine, string) {
	t.Helper()
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:canvas-revision-handler-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	user := &model.User{ID: "user-1", Username: "user-1", Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	rawToken := "session-secret"
	sum := sha256.Sum256([]byte(rawToken))
	session := &model.AuthSession{ID: "session-1", UserID: user.ID, TokenHash: hex.EncodeToString(sum[:]), ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(session).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	svc := service.New(repository.New(db), t.TempDir())
	previousRuntimeService := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() {
		runtimeService = previousRuntimeService
	})
	RegisterUserDataRoutes(router.Group("/api"), svc)
	return router, session.ID + "." + rawToken
}

func TestCanvasProjectPUTMissingPreconditionTargetKeepsConflictStatus(t *testing.T) {
	router, cookie := newCanvasRevisionHandlerTest(t)
	body := bytes.NewBufferString(`{"project":{"id":"deleted-canvas","title":"stale","nodes":[],"connections":[]},"expectedRevision":0,"expectedStateHash":"stale-hash"}`)
	req := httptest.NewRequest(http.MethodPut, "/api/canvas-projects/deleted-canvas", body)
	req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: cookie})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != http.StatusConflict || string(envelope.Data) != "null" {
		t.Fatalf("envelope = %#v", envelope)
	}
}
