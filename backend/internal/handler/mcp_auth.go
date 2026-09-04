package handler

import (
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterMCPAuthRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/mcp/auth/device", func(c *gin.Context) {
		var req service.CreateMCPDeviceSessionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CreateMCPDeviceSession(req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/mcp/auth/device/token", func(c *gin.Context) {
		var req struct {
			DeviceCode string `json:"device_code"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ExchangeMCPDeviceToken(req.DeviceCode)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/mcp/auth/device/:id", func(c *gin.Context) {
		result, err := svc.MCPDeviceApprovalInfo(c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/mcp/auth/device/:id/approve", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			UserCode string `json:"user_code"`
			Approve  *bool  `json:"approve"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if req.UserCode == "" {
			req.UserCode = c.Param("id")
		}
		approve := req.Approve != nil && *req.Approve
		result, err := svc.ApproveMCPDeviceSession(user.ID, req.UserCode, approve)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/mcp/auth/refresh", func(c *gin.Context) {
		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.RefreshMCPToken(req.RefreshToken)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/mcp/auth/revoke", func(c *gin.Context) {
		token, err := bearerToken(c)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RevokeMCPToken(token); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revoked": true})
	})
}

func bearerToken(c *gin.Context) (string, error) {
	header := strings.TrimSpace(c.GetHeader("Authorization"))
	parts := strings.Split(header, " ")
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" || strings.TrimSpace(parts[1]) != parts[1] || strings.ContainsAny(parts[1], " \t\r\n") {
		return "", service.NewAppError(http.StatusUnauthorized, "需要 Bearer token")
	}
	return parts[1], nil
}

func RequireMCPToken(c *gin.Context, svc *service.Service, requiredScope string) (*service.MCPPrincipal, error) {
	value, err := bearerToken(c)
	if err != nil {
		return nil, err
	}
	token, err := svc.MCPTokenForBearer(value)
	if err != nil {
		return nil, err
	}
	if requiredScope != "" && !token.Scopes[requiredScope] {
		return nil, service.NewAppError(http.StatusForbidden, "MCP token 缺少所需权限")
	}
	return token, nil
}
