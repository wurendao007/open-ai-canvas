package payment

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
)

func TestRPCProviderUsesPaymentV1Contract(t *testing.T) {
	// 用例依赖 #!/bin/sh 脚本可直接执行，而 call() 也固定 PATH=/usr/bin:/bin；
	// Windows 上没有 shebang 语义，无法跑通进程 ABI。路径校验由下面的
	// TestNewRPCProviderValidatesEntryPathAcrossPlatforms 覆盖，
	// 那部分是纯字符串逻辑，两个平台都必须一致。
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	dir := t.TempDir()
	entry := filepath.Join(dir, "provider")
	program := "#!/bin/sh\nread request\nprintf '%s\\n' '{\"ok\":true,\"data\":{\"mode\":\"qr_code\",\"value\":\"https://pay.example/qr\"}}'\n"
	if err := os.WriteFile(entry, []byte(program), 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin", CheckoutMode: "qr_code"}, dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	provider.command = entry
	checkout, err := provider.CreateOrder(context.Background(), Config{"merchantId": "m"}, CreateRequest{MerchantOrderNo: "order-1"})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "qr_code" || checkout.Value != "https://pay.example/qr" {
		t.Fatalf("checkout = %#v", checkout)
	}
}

func TestRPCProviderClassifiesExecutableStartFailures(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("executable error classification is asserted against Linux errno behavior")
	}
	tests := []struct {
		name    string
		content []byte
		mode    os.FileMode
		missing bool
		code    string
		message string
	}{
		{name: "missing", missing: true, code: "plugin_executable_missing", message: "支付插件可执行文件或其运行时加载器不可用"},
		{name: "missing-loader", content: []byte("#!/definitely/missing/payment-loader\n"), mode: 0o700, code: "plugin_executable_missing", message: "支付插件可执行文件或其运行时加载器不可用"},
		{name: "permission", content: []byte("#!/bin/sh\nexit 0\n"), mode: 0o600, code: "plugin_permission_denied", message: "支付插件没有执行权限"},
		{name: "mach-o", content: []byte{0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01}, mode: 0o700, code: "plugin_exec_format_error", message: "支付插件可执行文件与当前操作系统或 CPU 架构不兼容"},
		{name: "windows-pe", content: []byte{'M', 'Z', 0x90, 0x00}, mode: 0o700, code: "plugin_exec_format_error", message: "支付插件可执行文件与当前操作系统或 CPU 架构不兼容"},
		{name: "unknown-binary", content: []byte("not an executable\n"), mode: 0o700, code: "plugin_exec_format_error", message: "支付插件可执行文件与当前操作系统或 CPU 架构不兼容"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			entry := filepath.Join(dir, "backend", "provider")
			if !test.missing {
				if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(entry, test.content, test.mode); err != nil {
					t.Fatal(err)
				}
			}
			provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin"}, dir, "backend/provider")
			if err != nil {
				t.Fatal(err)
			}
			err = provider.ValidateConfig(Config{})
			var providerErr *ProviderError
			if !errors.As(err, &providerErr) {
				t.Fatalf("ValidateConfig() error = %T %v, want ProviderError", err, err)
			}
			if providerErr.Code != test.code || providerErr.Message != test.message || providerErr.Cause == nil {
				t.Fatalf("ProviderError = %#v, want code=%q message=%q with cause", providerErr, test.code, test.message)
			}
		})
	}
}

func TestClassifyPaymentPluginStartError(t *testing.T) {
	tests := []struct {
		name      string
		cause     error
		code      string
		temporary bool
	}{
		{name: "missing", cause: os.ErrNotExist, code: "plugin_executable_missing"},
		{name: "permission", cause: os.ErrPermission, code: "plugin_permission_denied"},
		{name: "format", cause: syscall.ENOEXEC, code: "plugin_exec_format_error"},
		{name: "generic", cause: errors.New("start failed"), code: "plugin_start_failed", temporary: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			providerErr := classifyPaymentPluginStartError(test.cause)
			if providerErr.Code != test.code || providerErr.Temporary != test.temporary || !errors.Is(providerErr, test.cause) {
				t.Fatalf("classifyPaymentPluginStartError() = %#v", providerErr)
			}
		})
	}
}

func TestRPCProviderDoesNotExposeProcessStderr(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	provider := testRPCProvider(t, "#!/bin/sh\nprintf '%s\\n' 'credential=super-secret' >&2\nexit 1\n")
	err := provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		t.Fatalf("ValidateConfig() error = %T %v, want ProviderError", err, err)
	}
	if providerErr.Code != "plugin_process_failed" || providerErr.Message != "支付插件进程异常退出" {
		t.Fatalf("ProviderError = %#v", providerErr)
	}
	if strings.Contains(providerErr.Error(), "super-secret") {
		t.Fatalf("process stderr leaked through public error: %q", providerErr.Error())
	}
}

func TestRPCProviderClassifiesInvalidJSONResponse(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	provider := testRPCProvider(t, "#!/bin/sh\nprintf '%s\\n' 'not-json'\n")
	err := provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "plugin_invalid_response" || providerErr.Message != "支付插件返回了无效响应" {
		t.Fatalf("ValidateConfig() error = %#v", err)
	}
}

func TestRPCProviderPreservesPluginValidationError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	provider := testRPCProvider(t, "#!/bin/sh\nprintf '%s\\n' '{\"ok\":false,\"code\":\"bad_config\",\"message\":\"配置无效\"}'\n")
	err := provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "bad_config" || providerErr.Message != "配置无效" {
		t.Fatalf("ValidateConfig() error = %#v", err)
	}
}

func testRPCProvider(t *testing.T, program string) *RPCProvider {
	t.Helper()
	dir := t.TempDir()
	entry := filepath.Join(dir, "backend", "provider")
	if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte(program), 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin"}, dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	return provider
}

// 插件清单里的 entry 是斜杠路径合同，校验必须与宿主操作系统无关：
// 用 filepath.Clean 时 Windows 会把 "backend/provider" 规范成反斜杠形式而与原值不等，
// 于是所有合法插件都被拒绝。越权路径在任何平台上都必须继续被拦住。
func TestNewRPCProviderValidatesEntryPathAcrossPlatforms(t *testing.T) {
	dir := t.TempDir()
	descriptor := Descriptor{ID: "test-provider", PluginID: "test-plugin"}
	provider, err := NewRPCProvider(descriptor, dir, "backend/provider")
	if err != nil {
		t.Fatalf("合法的斜杠 entry 被拒绝：%v", err)
	}
	if provider.command != filepath.Join(dir, filepath.FromSlash("backend/provider")) {
		t.Fatalf("command = %q", provider.command)
	}
	if _, err := NewRPCProvider(descriptor, dir, "backend/nested/provider"); err != nil {
		t.Fatalf("多级斜杠 entry 被拒绝：%v", err)
	}
	for name, entry := range map[string]string{
		"目录穿越":   "backend/../../etc/passwd",
		"未规范化路径": "backend/./provider",
		"越出前缀":   "plugins/provider",
		"反斜杠路径":  `backend\provider`,
		"绝对路径":   "/backend/provider",
		"空路径":    "",
	} {
		if _, err := NewRPCProvider(descriptor, dir, entry); err == nil {
			t.Fatalf("%s 应被拒绝：%q", name, entry)
		}
	}
}
