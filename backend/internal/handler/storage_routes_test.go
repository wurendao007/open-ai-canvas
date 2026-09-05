package handler

import (
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestStorageConnectionTestRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("/api")
	RegisterAdminRoutes(group, &service.Service{})
	RegisterAdminStorageRoutes(group, &service.Service{})
	RegisterUserDataRoutes(group, &service.Service{})
	wanted := map[string]bool{
		"POST /api/admin/settings/oss/test":       false,
		"POST /api/settings/oss/test":             false,
		"GET /api/resources/:id/direct-url":       false,
		"GET /api/admin/resources/:id/direct-url": false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
		}
	}
}

func TestResourceListLimitRejectsInvalidValues(t *testing.T) {
	for _, query := range []string{"?limit=0", "?limit=-1", "?limit=501", "?limit=not-a-number", "?limit="} {
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = httptest.NewRequest("GET", "/api/resources"+query, nil)
		if _, err := resourceListLimit(context); err == nil {
			t.Errorf("resourceListLimit(%q) accepted invalid value", query)
		}
	}

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "/api/resources?limit=25", nil)
	if limit, err := resourceListLimit(context); err != nil || limit != 25 {
		t.Fatalf("resourceListLimit(valid) = %d, %v", limit, err)
	}

	context, _ = gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "/api/resources", nil)
	if limit, err := resourceListLimit(context); err != nil || limit != 200 {
		t.Fatalf("resourceListLimit(default) = %d, %v", limit, err)
	}
}

func TestAdminResourcePaginationRejectsInvalidValues(t *testing.T) {
	for _, query := range []string{"?page=0", "?page=-1", "?page=1000001", "?page=not-a-number", "?page=", "?limit=0", "?limit=101", "?limit=not-a-number", "?limit="} {
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = httptest.NewRequest("GET", "/api/admin/resources"+query, nil)
		if _, _, err := adminResourcePagination(context); err == nil {
			t.Errorf("adminResourcePagination(%q) accepted invalid value", query)
		}
	}

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "/api/admin/resources?page=2&limit=50", nil)
	page, limit, err := adminResourcePagination(context)
	if err != nil || page != 2 || limit != 50 {
		t.Fatalf("adminResourcePagination(valid) = %d, %d, %v", page, limit, err)
	}

	context, _ = gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "/api/admin/resources", nil)
	page, limit, err = adminResourcePagination(context)
	if err != nil || page != 1 || limit != 20 {
		t.Fatalf("adminResourcePagination(default) = %d, %d, %v", page, limit, err)
	}
}
