package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func testAliyunCDNSetting() ossSettingValue {
	return normalizeOSSSetting(ossSettingValue{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com",
		CDNBaseURL: "https://media.example.com", CDNAuthType: cdnAuthTypeAliyunA, CDNAuthKey: "cdn-auth-key",
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
}

func TestCDNViewerAuthConfigurationRequiresAllFields(t *testing.T) {
	complete := testAliyunCDNSetting()
	if !cdnViewerAuthConfigured(complete) {
		t.Fatal("complete CDN viewer auth should be enabled")
	}
	for name, mutate := range map[string]func(ossSettingValue) ossSettingValue{
		"domain":   func(value ossSettingValue) ossSettingValue { value.CDNBaseURL = ""; return value },
		"type":     func(value ossSettingValue) ossSettingValue { value.CDNAuthType = ""; return value },
		"key":      func(value ossSettingValue) ossSettingValue { value.CDNAuthKey = ""; return value },
		"provider": func(value ossSettingValue) ossSettingValue { value.Provider = qiniuKodoProvider; return value },
	} {
		t.Run(name, func(t *testing.T) {
			if cdnViewerAuthConfigured(mutate(complete)) {
				t.Fatal("incomplete or unsupported CDN viewer auth was enabled")
			}
		})
	}
}

func TestCDNBaseURLRequiresHTTPSUnlessHostIsExplicitlyAllowed(t *testing.T) {
	if _, err := ossCDNBaseURL("http://media.example.com"); err == nil || !strings.Contains(err.Error(), "必须使用 HTTPS") {
		t.Fatalf("public HTTP CDN URL error = %v", err)
	}

	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "cdn.internal")
	parsed, err := ossCDNBaseURL("http://cdn.internal")
	if err != nil {
		t.Fatal(err)
	}
	if parsed.String() != "http://cdn.internal" {
		t.Fatalf("explicitly allowed private CDN URL = %q", parsed.String())
	}
}

func TestSignedCDNViewerURLSupportsConfiguredProviders(t *testing.T) {
	for _, testCase := range []struct {
		provider string
		authType string
		queryKey string
	}{
		{aliyunOSSProvider, cdnAuthTypeAliyunA, "auth_key"},
		{aliyunOSSProvider, cdnAuthTypeAliyunB, ""},
		{aliyunOSSProvider, cdnAuthTypeAliyunC, ""},
		{tencentCOSProvider, cdnAuthTypeTencentA, "sign"},
		{tencentCOSProvider, cdnAuthTypeTencentD, "sign"},
	} {
		t.Run(testCase.authType, func(t *testing.T) {
			setting := testAliyunCDNSetting()
			setting.Provider = testCase.provider
			setting.CDNAuthType = testCase.authType
			value, err := signedCDNViewerURL(setting, "users/u-1/image/test image.png", time.Now().Add(time.Hour))
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := url.Parse(value)
			if err != nil {
				t.Fatal(err)
			}
			if parsed.Host != "media.example.com" || !strings.HasSuffix(parsed.Path, "/users/u-1/image/test image.png") {
				t.Fatalf("signed CDN URL = %q", value)
			}
			if testCase.queryKey != "" && parsed.Query().Get(testCase.queryKey) == "" {
				t.Fatalf("signed CDN URL lacks %s: %q", testCase.queryKey, value)
			}
			if parsed.Query().Get("response-content-disposition") != "" {
				t.Fatalf("signed CDN URL contains an unsupported attachment parameter: %q", value)
			}
			allowedQueryKeys := map[string]bool{}
			if testCase.queryKey != "" {
				allowedQueryKeys[testCase.queryKey] = true
			}
			if testCase.authType == cdnAuthTypeTencentD {
				allowedQueryKeys["t"] = true
			}
			for key := range parsed.Query() {
				if !allowedQueryKeys[key] {
					t.Fatalf("signed CDN URL contains unexpected query parameter %q: %q", key, value)
				}
			}
			if strings.Contains(value, setting.CDNAuthKey) || strings.Contains(value, "%2520") {
				t.Fatalf("signed CDN URL leaks or double-escapes data: %q", value)
			}
		})
	}
}

func TestCDNAuthKeyIsEncryptedAtRest(t *testing.T) {
	svc := &Service{dataDir: t.TempDir()}
	stored, err := svc.encryptOSSSettingSecrets(testAliyunCDNSetting())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored.CDNAuthKey, encryptedSettingPrefix) || strings.Contains(stored.CDNAuthKey, "cdn-auth-key") {
		t.Fatalf("CDN auth key was not encrypted: %q", stored.CDNAuthKey)
	}
	if _, err := svc.decryptOSSSettingSecrets(&stored); err != nil {
		t.Fatal(err)
	}
	if stored.CDNAuthKey != "cdn-auth-key" {
		t.Fatalf("decrypted CDN auth key = %q", stored.CDNAuthKey)
	}
}

func TestOSSSettingValidatesAndRetainsCDNAuthKey(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", serverURL.Hostname())
	current := testAliyunCDNSetting()
	current.Endpoint = server.URL
	current.CDNBaseURL = server.URL

	kept, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, CDNBaseURL: server.URL,
		CDNAuthType: cdnAuthTypeAliyunA, Bucket: current.Bucket, AccessKeyID: current.AccessKeyID,
	}, current)
	if err != nil {
		t.Fatal(err)
	}
	if kept.CDNAuthKey != current.CDNAuthKey {
		t.Fatalf("retained CDN auth key = %q", kept.CDNAuthKey)
	}

	_, err = ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, CDNBaseURL: server.URL,
		CDNAuthType: cdnAuthTypeAliyunA, Bucket: current.Bucket, AccessKeyID: current.AccessKeyID,
		AccessKeySecret: current.AccessKeySecret,
	}, ossSettingValue{})
	if err == nil || !strings.Contains(err.Error(), "鉴权密钥") {
		t.Fatalf("missing CDN auth key error = %v", err)
	}

	_, err = ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: qiniuKodoProvider, Region: "z0", Endpoint: server.URL, CDNBaseURL: server.URL,
		CDNAuthType: cdnAuthTypeAliyunA, CDNAuthKey: "cdn-auth-key", Bucket: current.Bucket,
		AccessKeyID: current.AccessKeyID, AccessKeySecret: current.AccessKeySecret,
	}, ossSettingValue{})
	if err == nil || !strings.Contains(err.Error(), "不支持") {
		t.Fatalf("unsupported CDN auth type error = %v", err)
	}
}

func TestSignedQiniuBoundDomainUsesPrivateURL(t *testing.T) {
	value, err := signedQiniuObjectURL(ossSettingValue{
		Provider: qiniuKodoProvider, CDNBaseURL: "https://media.example.com",
		AccessKeyID: "qiniu-access-key", AccessKeySecret: "qiniu-secret-key",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour), "resource.png")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.Host != "media.example.com" || parsed.Path != "/users/u-1/image/test image.png" || query.Get("e") == "" || query.Get("token") == "" || query.Get("attname") != "resource.png" {
		t.Fatalf("signed Qiniu bound-domain URL = %q", value)
	}
	if strings.Contains(value, "qiniu-secret-key") {
		t.Fatal("signed Qiniu URL leaked the SecretKey")
	}
}

func TestPrepareResourceDeliveryUsesSignedCDNAndFallsBackWithoutAuth(t *testing.T) {
	svc := newResourceTestService(t)
	setting := testAliyunCDNSetting()
	encoded, err := json.Marshal(setting)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{
		ID: "resource-cdn-auth", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: setting.Endpoint, Bucket: setting.Bucket,
		ObjectKey: "users/user-1/image/cdn.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}

	delivery, err := svc.PrepareResourceDelivery(resource.UserID, resource.ID, ResourceDeliveryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(delivery.RedirectURL, "media.example.com/users/user-1/image/cdn.png") || urlQueryValue(delivery.RedirectURL, "auth_key") == "" {
		t.Fatalf("signed CDN delivery = %#v", delivery)
	}

	download, err := svc.PrepareResourceDelivery(resource.UserID, resource.ID, ResourceDeliveryOptions{Download: true})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(download.RedirectURL, "media.example.com") || urlQueryValue(download.RedirectURL, "Signature") == "" || urlQueryValue(download.RedirectURL, "response-content-disposition") != "attachment; filename=resource-cdn-auth.png" {
		t.Fatalf("CDN-auth download delivery = %#v, want signed origin URL with attachment disposition", download)
	}

	setting.CDNAuthType = ""
	setting.CDNAuthKey = ""
	encoded, err = json.Marshal(setting)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	fallback, err := svc.PrepareResourceDelivery(resource.UserID, resource.ID, ResourceDeliveryOptions{ForceDirect: true})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(fallback.RedirectURL, "media.example.com") || !strings.Contains(fallback.RedirectURL, "Signature=") {
		t.Fatalf("unsafe CDN fallback = %#v", fallback)
	}
}
