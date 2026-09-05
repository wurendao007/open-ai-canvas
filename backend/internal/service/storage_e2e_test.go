package service

// 真实凭据端到端校验。
//
// 既有的 verifyOSSConnection 只验证服务端到对象存储的读写删权限，走的是服务端
// 签名的源站请求。它验证不了浏览器实际拿到的东西：签名 URL 能否被匿名客户端
// 读取、下载是否带附件语义、签名过期后是否真的失效、以及轮换 AK/SK 后历史资源
// 是否仍可读。这些都要真实凭据才能确认，因此本文件由环境变量门控，默认跳过。
//
// 运行方式（每个厂商一组，未配置的自动跳过）：
//
//	CANVAS_E2E_STORAGE=1 \
//	CANVAS_E2E_ALIYUN='{"endpoint":"https://oss-cn-hangzhou.aliyuncs.com","bucket":"my-bucket","accessKeyId":"...","accessKeySecret":"..."}' \
//	go test ./internal/service -run TestStorageProviderEndToEnd -v -count=1
//
// 凭据只从环境变量读取，不写入仓库、不落盘，失败信息里也不回显密钥。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"strconv"
	"strings"
	"testing"
	"time"
)

type e2eProviderCase struct {
	name     string
	env      string
	provider string
}

var e2eProviderCases = []e2eProviderCase{
	{name: "aliyun", env: "CANVAS_E2E_ALIYUN", provider: aliyunOSSProvider},
	{name: "tencent", env: "CANVAS_E2E_TENCENT", provider: tencentCOSProvider},
	{name: "qiniu", env: "CANVAS_E2E_QINIU", provider: qiniuKodoProvider},
	{name: "s3", env: "CANVAS_E2E_S3", provider: s3Provider},
}

// e2eStorageConfig 对应 OSSSettingRequest 的可配置子集，用 JSON 从环境变量读入。
type e2eStorageConfig struct {
	Region          string `json:"region"`
	Endpoint        string `json:"endpoint"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
	SessionToken    string `json:"sessionToken"`
	PathPrefix      string `json:"pathPrefix"`
	S3Preset        string `json:"s3Preset"`
	PathStyle       bool   `json:"pathStyle"`
	// 可选：配置后额外验证轮换 AK/SK 后历史对象仍可读。
	RotatedAccessKeyID     string `json:"rotatedAccessKeyId"`
	RotatedAccessKeySecret string `json:"rotatedAccessKeySecret"`
}

func TestStorageProviderEndToEnd(t *testing.T) {
	if strings.TrimSpace(os.Getenv("CANVAS_E2E_STORAGE")) == "" {
		t.Skip("设置 CANVAS_E2E_STORAGE=1 并提供厂商凭据后运行真实端到端校验")
	}
	configured := 0
	for _, providerCase := range e2eProviderCases {
		raw := strings.TrimSpace(os.Getenv(providerCase.env))
		if raw == "" {
			continue
		}
		configured++
		t.Run(providerCase.name, func(t *testing.T) {
			var config e2eStorageConfig
			if err := json.Unmarshal([]byte(raw), &config); err != nil {
				t.Fatalf("%s 配置解析失败：%v", providerCase.env, err)
			}
			runStorageProviderEndToEnd(t, providerCase.provider, config)
		})
	}
	if configured == 0 {
		t.Fatal("CANVAS_E2E_STORAGE 已开启但未配置任何 CANVAS_E2E_* 厂商凭据")
	}
}

func runStorageProviderEndToEnd(t *testing.T, provider string, config e2eStorageConfig) {
	setting, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: provider, Region: config.Region, Endpoint: config.Endpoint,
		Bucket: config.Bucket, AccessKeyID: config.AccessKeyID,
		AccessKeySecret: config.AccessKeySecret, SessionToken: config.SessionToken,
		PathPrefix: config.PathPrefix, S3Preset: config.S3Preset, PathStyle: config.PathStyle,
	}, ossSettingValue{})
	if err != nil {
		t.Fatalf("配置校验失败：%v", err)
	}

	payload := []byte("yingce-e2e-storage-payload-0123456789")
	objectKey := path.Join(setting.PathPrefix, ".yingce-e2e", newID()+".bin")
	if _, err := putOSSObject(setting, objectKey, "application/octet-stream", int64(len(payload)), bytes.NewReader(payload)); err != nil {
		t.Fatalf("上传失败：%v", err)
	}
	t.Cleanup(func() {
		if err := deleteOSSObject(setting, objectKey); err != nil {
			t.Errorf("清理测试对象失败，请手动删除 %s：%v", objectKey, err)
		}
	})

	t.Run("preview-signature-anonymous-read", func(t *testing.T) {
		signed, err := signedOSSObjectURL(setting, objectKey, time.Now().Add(directResourceURLTTL))
		if err != nil {
			t.Fatalf("签发预览地址失败：%v", err)
		}
		body, header := fetchE2EURL(t, signed, "")
		if !bytes.Equal(body, payload) {
			t.Fatalf("预览内容不一致：读到 %d 字节，期望 %d 字节", len(body), len(payload))
		}
		if disposition := header.Get("Content-Disposition"); strings.Contains(strings.ToLower(disposition), "attachment") {
			t.Fatalf("预览响应不应带附件语义：Content-Disposition = %q", disposition)
		}
	})

	t.Run("range-request-partial-content", func(t *testing.T) {
		signed, err := signedOSSObjectURL(setting, objectKey, time.Now().Add(directResourceURLTTL))
		if err != nil {
			t.Fatalf("签发预览地址失败：%v", err)
		}
		body, header := fetchE2ERangeURL(t, signed, "bytes=0-7", http.StatusPartialContent)
		if !bytes.Equal(body, payload[:8]) {
			t.Fatalf("Range 分片不一致：%q", body)
		}
		if header.Get("Content-Range") == "" {
			t.Fatal("Range 响应缺少 Content-Range，视频拖动进度会失败")
		}
	})

	t.Run("download-signature-attachment", func(t *testing.T) {
		fileName := "e2e-download.bin"
		signed, err := signedOSSObjectURLForDownload(setting, objectKey, time.Now().Add(directResourceURLTTL), true, fileName)
		if err != nil {
			t.Fatalf("签发下载地址失败：%v", err)
		}
		body, header := fetchE2EURL(t, signed, "")
		if !bytes.Equal(body, payload) {
			t.Fatalf("下载内容不一致：读到 %d 字节", len(body))
		}
		disposition := header.Get("Content-Disposition")
		if !strings.Contains(strings.ToLower(disposition), "attachment") {
			t.Fatalf("下载响应缺少附件语义：Content-Disposition = %q", disposition)
		}
		if !strings.Contains(disposition, fileName) {
			t.Fatalf("下载响应未带上文件名 %q：Content-Disposition = %q", fileName, disposition)
		}
	})

	t.Run("expired-signature-rejected", func(t *testing.T) {
		signed, err := signedOSSObjectURL(setting, objectKey, time.Now().Add(-2*time.Minute))
		if err != nil {
			t.Skipf("该厂商在签发阶段即拒绝过期时间：%v", err)
		}
		response, err := e2eHTTPClient().Get(signed)
		if err != nil {
			t.Fatalf("过期签名请求失败：%v", err)
		}
		defer response.Body.Close()
		io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		if response.StatusCode < 400 {
			t.Fatalf("过期签名仍可读取，HTTP %d：短时授权形同长期公开地址", response.StatusCode)
		}
	})

	if strings.TrimSpace(config.RotatedAccessKeyID) == "" || strings.TrimSpace(config.RotatedAccessKeySecret) == "" {
		t.Log("未配置 rotatedAccessKeyId/rotatedAccessKeySecret，跳过凭据轮换校验")
		return
	}
	t.Run("rotated-credentials-read-historical-object", func(t *testing.T) {
		rotated := setting
		rotated.AccessKeyID = strings.TrimSpace(config.RotatedAccessKeyID)
		rotated.AccessKeySecret = strings.TrimSpace(config.RotatedAccessKeySecret)
		signed, err := signedOSSObjectURL(rotated, objectKey, time.Now().Add(directResourceURLTTL))
		if err != nil {
			t.Fatalf("轮换凭据签发失败：%v", err)
		}
		body, _ := fetchE2EURL(t, signed, "")
		if !bytes.Equal(body, payload) {
			t.Fatalf("轮换凭据读取历史对象内容不一致：%d 字节", len(body))
		}
	})
}

func fetchE2EURL(t *testing.T, signedURL string, rangeHeader string) ([]byte, http.Header) {
	t.Helper()
	return fetchE2ERangeURL(t, signedURL, rangeHeader, http.StatusOK)
}

// fetchE2ERangeURL 用匿名客户端请求签名地址，不带任何应用登录态，
// 以此复现浏览器直连对象存储的真实条件。
func fetchE2ERangeURL(t *testing.T, signedURL string, rangeHeader string, wantStatus int) ([]byte, http.Header) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, signedURL, nil)
	if err != nil {
		t.Fatalf("构造请求失败：%v", err)
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	response, err := e2eHTTPClient().Do(req)
	if err != nil {
		t.Fatalf("签名地址请求失败：%v", err)
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		t.Fatalf("读取响应失败：%v", readErr)
	}
	if response.StatusCode != wantStatus {
		t.Fatalf("HTTP %d，期望 %d：%s", response.StatusCode, wantStatus, e2eTruncate(string(body)))
	}
	return body, response.Header
}

func e2eHTTPClient() *http.Client {
	return &http.Client{Timeout: 2 * time.Minute}
}

func e2eTruncate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 400 {
		return value
	}
	return fmt.Sprintf("%s…（截断）", value[:400])
}

// TestStorageEndToEndAssertionsAgainstFakeObjectStore 让上面的断言在没有真实凭据时
// 也能被执行一次。它用一个最小对象存储替身校验断言本身的正确性——Range 分片、
// 附件语义与过期拒绝的判定逻辑，避免这套 E2E 代码在无人运行时腐化成死代码。
// 它不替代真实厂商验证：签名算法与厂商行为仍必须用真实凭据确认。
func TestStorageEndToEndAssertionsAgainstFakeObjectStore(t *testing.T) {
	payload := []byte("yingce-e2e-storage-payload-0123456789")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if expires := r.URL.Query().Get("expires"); expires != "" {
			if deadline, err := strconv.ParseInt(expires, 10, 64); err == nil && deadline < time.Now().Unix() {
				http.Error(w, "signature expired", http.StatusForbidden)
				return
			}
		}
		if name := r.URL.Query().Get("attname"); name != "" {
			w.Header().Set("Content-Disposition", ContentDispositionAttachment(name))
		}
		w.Header().Set("Accept-Ranges", "bytes")
		http.ServeContent(w, r, "object.bin", time.Now(), bytes.NewReader(payload))
	}))
	defer server.Close()

	t.Run("full read matches the stored payload", func(t *testing.T) {
		body, header := fetchE2EURL(t, server.URL+"/object.bin", "")
		if !bytes.Equal(body, payload) {
			t.Fatalf("body = %q", body)
		}
		if strings.Contains(strings.ToLower(header.Get("Content-Disposition")), "attachment") {
			t.Fatal("预览响应不应带附件语义")
		}
	})

	t.Run("range read returns partial content", func(t *testing.T) {
		body, header := fetchE2ERangeURL(t, server.URL+"/object.bin", "bytes=0-7", http.StatusPartialContent)
		if !bytes.Equal(body, payload[:8]) {
			t.Fatalf("range body = %q", body)
		}
		if header.Get("Content-Range") == "" {
			t.Fatal("缺少 Content-Range")
		}
	})

	t.Run("download carries attachment disposition", func(t *testing.T) {
		_, header := fetchE2EURL(t, server.URL+"/object.bin?attname=e2e-download.bin", "")
		disposition := header.Get("Content-Disposition")
		if !strings.Contains(strings.ToLower(disposition), "attachment") || !strings.Contains(disposition, "e2e-download.bin") {
			t.Fatalf("Content-Disposition = %q", disposition)
		}
	})

	t.Run("expired signature is rejected", func(t *testing.T) {
		expired := fmt.Sprintf("%s/object.bin?expires=%d", server.URL, time.Now().Add(-2*time.Minute).Unix())
		response, err := e2eHTTPClient().Get(expired)
		if err != nil {
			t.Fatalf("请求失败：%v", err)
		}
		defer response.Body.Close()
		io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		if response.StatusCode < 400 {
			t.Fatalf("过期签名仍可读取，HTTP %d", response.StatusCode)
		}
	})
}
