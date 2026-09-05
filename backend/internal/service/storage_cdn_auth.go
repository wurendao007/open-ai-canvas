package service

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	cdnAuthTypeAliyunA  = "aliyun_a"
	cdnAuthTypeAliyunB  = "aliyun_b"
	cdnAuthTypeAliyunC  = "aliyun_c"
	cdnAuthTypeTencentA = "tencent_a"
	cdnAuthTypeTencentD = "tencent_d"
)

func normalizeCDNAuthType(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func supportedCDNAuthTypes(provider string) []string {
	switch provider {
	case aliyunOSSProvider:
		return []string{cdnAuthTypeAliyunA, cdnAuthTypeAliyunB, cdnAuthTypeAliyunC}
	case tencentCOSProvider:
		return []string{cdnAuthTypeTencentA, cdnAuthTypeTencentD}
	default:
		return nil
	}
}

func validCDNAuthType(provider string, authType string) bool {
	authType = normalizeCDNAuthType(authType)
	if authType == "" {
		return true
	}
	for _, supported := range supportedCDNAuthTypes(provider) {
		if supported == authType {
			return true
		}
	}
	return false
}

func cdnViewerAuthConfigured(setting ossSettingValue) bool {
	if strings.TrimSpace(setting.CDNBaseURL) == "" || strings.TrimSpace(setting.CDNAuthKey) == "" {
		return false
	}
	authType := normalizeCDNAuthType(setting.CDNAuthType)
	if authType == "" {
		return false
	}
	for _, supported := range supportedCDNAuthTypes(setting.Provider) {
		if supported == authType {
			return true
		}
	}
	return false
}

func signedCDNViewerURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	setting = normalizeOSSSetting(setting)
	if !cdnViewerAuthConfigured(setting) {
		return "", errors.New("CDN 鉴权未配置完成，无法签发 CDN 地址")
	}
	base, err := ossCDNBaseURL(setting.CDNBaseURL)
	if err != nil {
		return "", err
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", errors.New("CDN 对象路径为空")
	}
	uri := "/" + objectKey
	deadline := expiresAt.Unix()
	if deadline <= time.Now().Unix() {
		return "", errors.New("CDN 签名有效期必须晚于当前时间")
	}
	// Viewer 鉴权 URL 必须保持厂商规定的最小签名参数集合；下载文件名
	// 由源站预签名或同源代理的 Content-Disposition 提供。
	query := url.Values{}

	switch normalizeCDNAuthType(setting.CDNAuthType) {
	case cdnAuthTypeAliyunA:
		signature := cdnAuthMD5(fmt.Sprintf("%s-%d-0-0-%s", uri, deadline, setting.CDNAuthKey))
		query.Set("auth_key", fmt.Sprintf("%d-0-0-%s", deadline, signature))
		base.Path = uri
	case cdnAuthTypeAliyunB:
		minute := expiresAt.UTC().Format("200601021504")
		signature := cdnAuthMD5(setting.CDNAuthKey + minute + uri)
		base.Path = "/" + minute + "/" + signature + uri
	case cdnAuthTypeAliyunC:
		hexDeadline := strconv.FormatInt(deadline, 16)
		signature := cdnAuthMD5(setting.CDNAuthKey + uri + hexDeadline)
		base.Path = "/" + signature + "/" + hexDeadline + uri
	case cdnAuthTypeTencentA:
		signature := cdnAuthMD5(fmt.Sprintf("%s-%d-0-0-%s", uri, deadline, setting.CDNAuthKey))
		query.Set("sign", fmt.Sprintf("%d-0-0-%s", deadline, signature))
		base.Path = uri
	case cdnAuthTypeTencentD:
		hexDeadline := strconv.FormatInt(deadline, 16)
		query.Set("sign", cdnAuthMD5(setting.CDNAuthKey+uri+hexDeadline))
		query.Set("t", hexDeadline)
		base.Path = uri
	default:
		return "", errors.New("不支持的 CDN 鉴权方式")
	}
	base.RawQuery = query.Encode()
	return base.String(), nil
}

func ossCDNBaseURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" {
		return nil, errors.New("对象存储 CDN 加速域名格式不正确")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("对象存储 CDN 加速域名只支持 http/https")
	}
	if parsed.Scheme == "http" && !allowedPrivateUpstreamHost(parsed.Hostname()) {
		return nil, errors.New("对象存储 CDN 加速域名必须使用 HTTPS；内网主机需通过 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS 精确放行")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.Path, "/") != "" {
		return nil, errors.New("对象存储 CDN 加速域名不能包含认证信息、路径、查询参数或片段")
	}
	parsed.Path = ""
	return parsed, nil
}

func cdnAuthMD5(value string) string {
	sum := md5.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}
