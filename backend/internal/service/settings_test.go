package service

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMissingOSSSettingsReturnNormalizedDefaults(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}

	platformSetting, err := svc.AdminOSSSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	assertDefaultOSSSetting(t, platformSetting)

	userSetting, err := svc.UserOSSSetting(&model.User{ID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	if userSetting.Provider != "" || userSetting.Configured || userSetting.EffectiveProvider != "" || userSetting.StorageMode != "local" {
		t.Fatalf("unconfigured user OSS setting = %+v", userSetting)
	}
}

func assertDefaultOSSSetting(t *testing.T, value *PublicOSSSetting) {
	t.Helper()
	if value.Provider != aliyunOSSProvider || value.PathPrefix != defaultOSSPathPrefix || value.S3Preset != "custom" || value.StorageMode != "local" {
		t.Fatalf("default OSS setting = %+v", value)
	}
}

func TestUserOSSSettingReportsEffectivePlatformProviderSeparately(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	platformJSON, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: tencentCOSProvider, Endpoint: "https://cos.example.com", Bucket: "platform", AccessKeyID: "id", AccessKeySecret: "secret"})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(platformJSON)}); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.UserOSSSetting(&model.User{ID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	if setting.Provider != "" || setting.Configured || setting.EffectiveProvider != tencentCOSProvider || setting.StorageMode != "oss" {
		t.Fatalf("user OSS setting = %+v", setting)
	}
}
