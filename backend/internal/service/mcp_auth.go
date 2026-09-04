package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	MCPDeviceSessionTTL = 10 * time.Minute
	MCPAccessTokenTTL   = 15 * time.Minute
	MCPRefreshTokenTTL  = 30 * 24 * time.Hour
)

var allowedMCPScope = map[string]bool{"canvas:read": true, "canvas:write": true, "canvas:generate": true}

type CreateMCPDeviceSessionRequest struct {
	ClientName string   `json:"client_name"`
	Scopes     []string `json:"scope"`
	Scope      string   `json:"-"`
}

func (r *CreateMCPDeviceSessionRequest) UnmarshalJSON(data []byte) error {
	var raw struct {
		ClientName string          `json:"client_name"`
		Scope      json.RawMessage `json:"scope"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	r.ClientName = raw.ClientName
	if len(raw.Scope) == 0 || string(raw.Scope) == "null" {
		return nil
	}
	if err := json.Unmarshal(raw.Scope, &r.Scopes); err == nil {
		return nil
	}
	if err := json.Unmarshal(raw.Scope, &r.Scope); err != nil {
		return err
	}
	return nil
}

type MCPDeviceSessionResponse struct {
	DeviceCode              string   `json:"device_code"`
	UserCode                string   `json:"user_code"`
	VerificationURI         string   `json:"verification_uri"`
	VerificationURIComplete string   `json:"verification_uri_complete"`
	ExpiresIn               int      `json:"expires_in"`
	Interval                int      `json:"interval"`
	ClientName              string   `json:"client_name"`
	Scopes                  []string `json:"scope"`
}

type MCPDeviceApproval struct {
	ClientName string    `json:"client_name"`
	Scopes     []string  `json:"scope"`
	ExpiresAt  time.Time `json:"expires_at"`
	Status     string    `json:"status"`
}

type MCPTokenResponse struct {
	AccessToken  string   `json:"access_token,omitempty"`
	RefreshToken string   `json:"refresh_token,omitempty"`
	TokenType    string   `json:"token_type,omitempty"`
	ExpiresIn    int      `json:"expires_in,omitempty"`
	Scope        []string `json:"scope,omitempty"`
	Status       string   `json:"status,omitempty"`
}

type MCPPrincipal struct {
	UserID string
	Scopes map[string]bool
	Token  *model.MCPToken
}

func (s *Service) MCPTokenForBearer(value string) (*MCPPrincipal, error) {
	token, err := s.repo.MCPTokenByHash(mcpHash(strings.TrimSpace(value)))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(401, "MCP token 无效")
	}
	if err != nil {
		return nil, err
	}
	if token.Status != "access" || token.RevokedAt != nil || !time.Now().Before(token.ExpiresAt) {
		return nil, NewAppError(401, "MCP token 已失效")
	}
	user, err := s.repo.User(token.UserID)
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, Forbidden("该账号已被禁用")
	}
	scopes := map[string]bool{}
	for _, scope := range decodeMCPScopes(token.ScopesJSON) {
		scopes[scope] = true
	}
	return &MCPPrincipal{UserID: user.ID, Scopes: scopes, Token: token}, nil
}

func normalizeMCPScope(scopes []string) ([]string, error) {
	seen := map[string]bool{}
	result := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" || !allowedMCPScope[scope] {
			return nil, errors.New("请求了不支持的 MCP 权限")
		}
		if !seen[scope] {
			seen[scope] = true
			result = append(result, scope)
		}
	}
	if len(result) == 0 {
		return nil, errors.New("至少需要请求一个 MCP 权限")
	}
	return result, nil
}

func randomMCPSecret(bytes int) (string, error) {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func mcpHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (s *Service) CreateMCPDeviceSession(req CreateMCPDeviceSessionRequest) (*MCPDeviceSessionResponse, error) {
	if len(req.Scopes) == 0 && strings.TrimSpace(req.Scope) != "" {
		req.Scopes = strings.Fields(req.Scope)
	}
	scopes, err := normalizeMCPScope(req.Scopes)
	if err != nil {
		return nil, NewAppError(400, err.Error())
	}
	deviceCode, err := randomMCPSecret(32)
	if err != nil {
		return nil, err
	}
	userCode, err := randomMCPSecret(6)
	if err != nil {
		return nil, err
	}
	userCode = strings.ToUpper(userCode[:8])
	clientName := strings.TrimSpace(req.ClientName)
	if clientName == "" {
		clientName = "MCP 客户端"
	}
	now := time.Now()
	expires := now.Add(MCPDeviceSessionTTL)
	scopesJSON, _ := json.Marshal(scopes)
	session := &model.MCPDeviceSession{ID: newID(), DeviceCodeHash: mcpHash(deviceCode), UserCodeHash: mcpHash(userCode), ClientName: clientName, ScopesJSON: string(scopesJSON), Status: "pending", ExpiresAt: expires, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateMCPDeviceSession(session); err != nil {
		return nil, err
	}
	verificationURI := "/mcp/device"
	return &MCPDeviceSessionResponse{DeviceCode: deviceCode, UserCode: userCode, VerificationURI: verificationURI, VerificationURIComplete: verificationURI + "?code=" + url.QueryEscape(userCode), ExpiresIn: int(MCPDeviceSessionTTL.Seconds()), Interval: 5, ClientName: clientName, Scopes: scopes}, nil
}

func decodeMCPScopes(raw string) []string {
	var scopes []string
	_ = json.Unmarshal([]byte(raw), &scopes)
	return scopes
}

func (s *Service) ApproveMCPDeviceSession(userID, userCode string, approve bool) (*MCPDeviceApproval, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	user, err := s.repo.User(userID)
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, Forbidden("该账号已被禁用")
	}
	session, err := s.repo.ApproveMCPDeviceSession(userID, mcpHash(strings.ToUpper(strings.TrimSpace(userCode))), map[bool]string{true: "approved", false: "denied"}[approve], time.Now())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(400, "设备验证码无效、已过期或已处理")
	}
	if err != nil {
		return nil, err
	}
	return &MCPDeviceApproval{ClientName: session.ClientName, Scopes: decodeMCPScopes(session.ScopesJSON), ExpiresAt: session.ExpiresAt, Status: session.Status}, nil
}

func (s *Service) MCPDeviceApprovalInfo(userCode string) (*MCPDeviceApproval, error) {
	session, err := s.repo.MCPDeviceSessionByUserCode(mcpHash(strings.ToUpper(strings.TrimSpace(userCode))))
	if errors.Is(err, gorm.ErrRecordNotFound) || session == nil || !time.Now().Before(session.ExpiresAt) || session.Status != "pending" {
		return nil, NewAppError(400, "设备验证码无效、已过期或已处理")
	}
	return &MCPDeviceApproval{ClientName: session.ClientName, Scopes: decodeMCPScopes(session.ScopesJSON), ExpiresAt: session.ExpiresAt, Status: session.Status}, nil
}

func (s *Service) ExchangeMCPDeviceToken(deviceCode string) (*MCPTokenResponse, error) {
	session, err := s.repo.ConsumeApprovedMCPDeviceSession(mcpHash(strings.TrimSpace(deviceCode)), time.Now())
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &MCPTokenResponse{Status: "invalid"}, nil
		}
		return nil, err
	}
	if session.Status == "pending" {
		return &MCPTokenResponse{Status: "pending"}, nil
	}
	if session.Status == "denied" || session.Status == "expired" || session.Status == "consumed" {
		return &MCPTokenResponse{Status: session.Status}, nil
	}
	if session.Status != "approved" || session.UserID == "" {
		return &MCPTokenResponse{Status: "invalid"}, nil
	}
	user, err := s.repo.User(session.UserID)
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, Forbidden("该账号已被禁用")
	}
	scopes := decodeMCPScopes(session.ScopesJSON)
	return s.issueMCPTokenPair(user.ID, session.ID, scopes)
}

func (s *Service) issueMCPTokenPair(userID, sessionID string, scopes []string) (*MCPTokenResponse, error) {
	access, err := randomMCPSecret(32)
	if err != nil {
		return nil, err
	}
	refresh, err := randomMCPSecret(48)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	family := newID()
	if err := s.repo.CreateMCPToken(&model.MCPToken{ID: newID(), UserID: userID, DeviceSessionID: sessionID, TokenHash: mcpHash(access), TokenFamilyID: family, ScopesJSON: mcpJSON(scopes), Status: "access", ExpiresAt: now.Add(MCPAccessTokenTTL), CreatedAt: now, UpdatedAt: now}); err != nil {
		return nil, err
	}
	if err := s.repo.CreateMCPToken(&model.MCPToken{ID: newID(), UserID: userID, DeviceSessionID: sessionID, TokenHash: mcpHash(refresh), TokenFamilyID: family, ScopesJSON: mcpJSON(scopes), Status: "refresh", ExpiresAt: now.Add(MCPRefreshTokenTTL), CreatedAt: now, UpdatedAt: now}); err != nil {
		return nil, err
	}
	return &MCPTokenResponse{AccessToken: access, RefreshToken: refresh, TokenType: "Bearer", ExpiresIn: int(MCPAccessTokenTTL.Seconds()), Scope: scopes}, nil
}

func mcpJSON(value any) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func (s *Service) RefreshMCPToken(refreshToken string) (*MCPTokenResponse, error) {
	raw := strings.TrimSpace(refreshToken)
	token, err := s.repo.MCPTokenByHash(mcpHash(raw))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(401, "refresh token 无效")
	}
	if err != nil {
		return nil, err
	}
	user, err := s.repo.User(token.UserID)
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, Forbidden("该账号已被禁用")
	}
	access, err := randomMCPSecret(32)
	if err != nil {
		return nil, err
	}
	refresh, err := randomMCPSecret(48)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	replacement := &model.MCPToken{ID: newID(), UserID: token.UserID, DeviceSessionID: token.DeviceSessionID, TokenHash: mcpHash(refresh), TokenFamilyID: token.TokenFamilyID, ScopesJSON: token.ScopesJSON, Status: "refresh", ExpiresAt: now.Add(MCPRefreshTokenTTL), CreatedAt: now, UpdatedAt: now}
	accessToken := &model.MCPToken{ID: newID(), UserID: token.UserID, DeviceSessionID: token.DeviceSessionID, TokenHash: mcpHash(access), TokenFamilyID: token.TokenFamilyID, ScopesJSON: token.ScopesJSON, Status: "access", ExpiresAt: now.Add(MCPAccessTokenTTL), CreatedAt: now, UpdatedAt: now}
	if _, err := s.repo.RotateMCPRefreshToken(mcpHash(raw), now, replacement, accessToken); err != nil {
		// A replay is a security event: revoke the family even though the
		// rotation transaction itself must roll back.
		_ = s.repo.RevokeMCPTokenFamily(token.TokenFamilyID, now)
		return nil, NewAppError(401, "refresh token 无效或已被撤销")
	}
	return &MCPTokenResponse{AccessToken: access, RefreshToken: refresh, TokenType: "Bearer", ExpiresIn: int(MCPAccessTokenTTL.Seconds()), Scope: decodeMCPScopes(token.ScopesJSON)}, nil
}

func (s *Service) RevokeMCPToken(tokenValue string) error {
	token, err := s.repo.MCPTokenByHash(mcpHash(strings.TrimSpace(tokenValue)))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NewAppError(401, "token 无效")
	}
	if err != nil {
		return err
	}
	return s.repo.RevokeMCPTokenFamily(token.TokenFamilyID, time.Now())
}
