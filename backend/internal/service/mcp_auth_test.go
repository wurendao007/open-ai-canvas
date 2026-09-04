package service

import (
	"encoding/json"
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

func TestMCPDeviceScopeAcceptsStringAndArray(t *testing.T) {
	svc, _ := newMCPTestService(t)
	for _, req := range []CreateMCPDeviceSessionRequest{
		{Scope: "canvas:read canvas:write"},
		{Scopes: []string{"canvas:read", "canvas:write"}},
	} {
		result, err := svc.CreateMCPDeviceSession(req)
		if err != nil || len(result.Scopes) != 2 {
			t.Fatalf("request %#v -> %#v, %v", req, result, err)
		}
	}
	var req CreateMCPDeviceSessionRequest
	if err := json.Unmarshal([]byte(`{"scope":"canvas:read canvas:generate"}`), &req); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateMCPDeviceSession(req); err != nil {
		t.Fatal(err)
	}
}

func TestMCPAccessValidationScopesDisabledAndExpiry(t *testing.T) {
	svc, db := newMCPTestService(t)
	user := &model.User{ID: "access-user", Username: "access-user", Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	pair, err := svc.issueMCPTokenPair(user.ID, "session", []string{"canvas:read"})
	if err != nil {
		t.Fatal(err)
	}
	principal, err := svc.MCPTokenForBearer(pair.AccessToken)
	if err != nil || !principal.Scopes["canvas:read"] {
		t.Fatalf("principal = %#v, err=%v", principal, err)
	}
	var access model.MCPToken
	if err := db.Where("status = ?", "access").First(&access).Error; err != nil {
		t.Fatal(err)
	}
	access.ExpiresAt = time.Now().Add(-time.Minute)
	if err := db.Save(&access).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MCPTokenForBearer(pair.AccessToken); err == nil {
		t.Fatal("expected expired access rejection")
	}
	access.ExpiresAt = time.Now().Add(time.Minute)
	access.Status = "access"
	if err := db.Save(&access).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RefreshMCPToken(pair.RefreshToken); err != nil {
		t.Fatal(err)
	}
	var refresh model.MCPToken
	if err := db.Where("status = ?", "refresh").First(&refresh).Error; err != nil {
		t.Fatal(err)
	}
	refresh.ExpiresAt = time.Now().Add(-time.Minute)
	if err := db.Save(&refresh).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RefreshMCPToken(pair.RefreshToken); err == nil {
		t.Fatal("expected rotated refresh rejection")
	}
	expiringPair, err := svc.issueMCPTokenPair(user.ID, "session", []string{"canvas:read"})
	if err != nil {
		t.Fatal(err)
	}
	var expiringRefresh model.MCPToken
	if err := db.Where("token_hash = ?", mcpHash(expiringPair.RefreshToken)).First(&expiringRefresh).Error; err != nil {
		t.Fatal(err)
	}
	expiringRefresh.ExpiresAt = time.Now().Add(-time.Minute)
	if err := db.Save(&expiringRefresh).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RefreshMCPToken(expiringPair.RefreshToken); err == nil {
		t.Fatal("expected expired refresh rejection")
	}
	disabled := &model.User{ID: "disabled-access", Username: "disabled-access", Status: model.UserStatusDisabled}
	if err := db.Create(disabled).Error; err != nil {
		t.Fatal(err)
	}
	disabledPair, err := svc.issueMCPTokenPair(disabled.ID, "session", []string{"canvas:read"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MCPTokenForBearer(disabledPair.AccessToken); err == nil {
		t.Fatal("expected disabled user access rejection")
	}
}

func TestMCPRejectsUnsupportedScope(t *testing.T) {
	svc, _ := newMCPTestService(t)
	if _, err := svc.CreateMCPDeviceSession(CreateMCPDeviceSessionRequest{Scopes: []string{"canvas:admin"}}); err == nil {
		t.Fatal("expected unsupported scope rejection")
	}
}

func TestMCPDeniedDevicePolling(t *testing.T) {
	svc, db := newMCPTestService(t)
	user := &model.User{ID: "deny-user", Username: "deny-user", Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateMCPDeviceSession(CreateMCPDeviceSessionRequest{Scopes: []string{"canvas:read"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApproveMCPDeviceSession(user.ID, created.UserCode, false); err != nil {
		t.Fatal(err)
	}
	result, err := svc.ExchangeMCPDeviceToken(created.DeviceCode)
	if err != nil || result.Status != "denied" {
		t.Fatalf("result = %#v, err=%v", result, err)
	}
}

func TestMCPTokenPairCreationIsAtomic(t *testing.T) {
	svc, db := newMCPTestService(t)
	user := &model.User{ID: "atomic-user", Username: "atomic-user", Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	existing := &model.MCPToken{ID: "duplicate-id", UserID: user.ID, TokenHash: "existing", TokenFamilyID: "family", Status: "access", ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(existing).Error; err != nil {
		t.Fatal(err)
	}
	old := &model.MCPToken{ID: "old-refresh", UserID: user.ID, TokenHash: "old-refresh-hash", TokenFamilyID: "family", Status: "refresh", ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(old).Error; err != nil {
		t.Fatal(err)
	}
	replacement := &model.MCPToken{ID: "replacement", UserID: user.ID, TokenHash: "replacement", TokenFamilyID: "family", Status: "refresh", ExpiresAt: time.Now().Add(time.Hour)}
	access := &model.MCPToken{ID: "duplicate-id", UserID: user.ID, TokenHash: "new-access", TokenFamilyID: "family", Status: "access", ExpiresAt: time.Now().Add(time.Hour)}
	if _, err := svc.repo.RotateMCPRefreshToken("old-refresh-hash", time.Now(), replacement, access); err == nil {
		t.Fatal("expected atomic rotation failure")
	}
	var count int64
	if err := db.Model(&model.MCPToken{}).Where("id = ?", "replacement").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("replacement token was partially inserted")
	}
}
