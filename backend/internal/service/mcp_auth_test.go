package service

import (
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

func newMCPTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: fmt.Sprintf("file:mcp-auth-%s?mode=memory&cache=shared", t.Name())})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.MCPDeviceSession{}, &model.MCPToken{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

func TestMCPDeviceApprovalExchangeIsSingleUse(t *testing.T) {
	svc, db := newMCPTestService(t)
	user := &model.User{ID: "mcp-user", Username: "mcp-user", Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateMCPDeviceSession(CreateMCPDeviceSessionRequest{ClientName: "Canvas CLI", Scopes: []string{"canvas:read"}})
	if err != nil {
		t.Fatal(err)
	}
	pending, err := svc.ExchangeMCPDeviceToken(created.DeviceCode)
	if err != nil || pending.Status != "pending" {
		t.Fatalf("pending = %#v, err=%v", pending, err)
	}
	if _, err := svc.ApproveMCPDeviceSession(user.ID, created.UserCode, true); err != nil {
		t.Fatal(err)
	}
	tokens, err := svc.ExchangeMCPDeviceToken(created.DeviceCode)
	if err != nil || tokens.AccessToken == "" || tokens.RefreshToken == "" {
		t.Fatalf("tokens = %#v, err=%v", tokens, err)
	}
	again, err := svc.ExchangeMCPDeviceToken(created.DeviceCode)
	if err != nil || again.Status != "consumed" {
		t.Fatalf("replay = %#v, err=%v", again, err)
	}
	var stored model.MCPToken
	if err := db.First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.TokenHash == tokens.AccessToken || stored.TokenHash == tokens.RefreshToken {
		t.Fatal("plain token was persisted")
	}
}

func TestMCPApprovalRequiresActiveUserAndExpiry(t *testing.T) {
	svc, db := newMCPTestService(t)
	if _, err := svc.ApproveMCPDeviceSession("", "code", true); err == nil {
		t.Fatal("expected unauthenticated approval rejection")
	}
	user := &model.User{ID: "disabled", Username: "disabled", Status: model.UserStatusDisabled}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateMCPDeviceSession(CreateMCPDeviceSessionRequest{Scopes: []string{"canvas:read"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApproveMCPDeviceSession(user.ID, created.UserCode, true); err == nil {
		t.Fatal("expected disabled user rejection")
	}
	var session model.MCPDeviceSession
	if err := db.First(&session).Error; err != nil {
		t.Fatal(err)
	}
	session.ExpiresAt = time.Now().Add(-time.Minute)
	if err := db.Save(&session).Error; err != nil {
		t.Fatal(err)
	}
	active := &model.User{ID: "active", Username: "active", Status: model.UserStatusActive}
	if err := db.Create(active).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApproveMCPDeviceSession(active.ID, created.UserCode, true); err == nil {
		t.Fatal("expected expired rejection")
	}
}

func TestMCPRefreshRotationReplayRevokesFamilyAndScopes(t *testing.T) {
	svc, db := newMCPTestService(t)
	user := &model.User{ID: "rotate", Username: "rotate", Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	pair, err := svc.issueMCPTokenPair(user.ID, "session", []string{"canvas:read"})
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := svc.RefreshMCPToken(pair.RefreshToken)
	if err != nil || rotated.RefreshToken == pair.RefreshToken {
		t.Fatalf("rotated = %#v, err=%v", rotated, err)
	}
	if _, err := svc.RefreshMCPToken(pair.RefreshToken); err == nil {
		t.Fatal("expected refresh replay rejection")
	}
	if _, err := svc.MCPTokenForBearer(rotated.AccessToken); err == nil {
		t.Fatal("family replay should revoke replacement access token")
	}
	if _, err := svc.RefreshMCPToken(rotated.RefreshToken); err == nil {
		t.Fatal("family replay should revoke replacement refresh token")
	}
}
