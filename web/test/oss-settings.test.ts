import { describe, expect, test } from "bun:test";

import { changesRequireOSSRetest, DEFAULT_OSS_PATH_PREFIX, getCDNAuthTypeOptions, getS3PresetHints, isPrivateCDNHost, isValidCDNAuthType, isValidCDNBaseURL, normalizeOSSConnectionTestInput, supportsCDNViewerAuth, validateCDNViewerAuth } from "../src/lib/oss-settings";

describe("OSS settings helpers", () => {
    test("provides editable S3 endpoint hints for known presets", () => {
        expect(getS3PresetHints("r2")).toMatchObject({ region: "auto" });
        expect(getS3PresetHints("b2").endpoint).toContain("backblazeb2.com");
    });

    test("only connection fields invalidate a previous test", () => {
        expect(changesRequireOSSRetest({ endpoint: "https://s3.example.com" })).toBe(true);
        expect(changesRequireOSSRetest({ enabled: true })).toBe(false);
        expect(changesRequireOSSRetest({ allowUserS3: true })).toBe(false);
    });

    test("uses the product path prefix by default", () => {
        expect(DEFAULT_OSS_PATH_PREFIX).toBe("open-ai-canvas");
    });

    test("normalizes a Tencent COS test draft when S3-only fields are not mounted", () => {
        const input = normalizeOSSConnectionTestInput({
            provider: "tencent",
            region: " ap-guangzhou ",
            endpoint: " https://cos.ap-guangzhou.myqcloud.com/ ",
            bucket: " example-1250000000 ",
            accessKeyId: " secret-id ",
            accessKeySecret: " secret-key ",
            pathPrefix: " /canvas/ ",
        });

        expect(input).toMatchObject({
            provider: "tencent",
            region: "ap-guangzhou",
            endpoint: "https://cos.ap-guangzhou.myqcloud.com",
            cdnBaseUrl: "",
            cdnAuthType: "",
            cdnAuthKey: "",
            bucket: "example-1250000000",
            accessKeyId: "secret-id",
            accessKeySecret: "secret-key",
            sessionToken: "",
            pathPrefix: "canvas",
            s3Preset: "custom",
            pathStyle: false,
        });
    });
});

describe("CDN base URL validation", () => {
    test("requires HTTPS for public CDN and bound domains", () => {
        expect(isValidCDNBaseURL("https://media.example.com")).toBe(true);
        expect(isValidCDNBaseURL("http://media.example.com")).toBe(false);
    });

    test("keeps HTTP available for private deployments without certificates", () => {
        for (const value of ["http://localhost:9000", "http://cdn.internal", "http://minio", "http://127.0.0.1:9000", "http://10.1.2.3", "http://192.168.1.10", "http://172.16.0.5"]) {
            expect(isValidCDNBaseURL(value)).toBe(true);
        }
    });

    test("rejects a domain carrying a path, query, fragment or credentials", () => {
        for (const value of ["https://media.example.com/assets", "https://media.example.com?token=value", "https://media.example.com#hash", "https://user:pass@media.example.com", "ftp://media.example.com", "media.example.com", ""]) {
            expect(isValidCDNBaseURL(value)).toBe(false);
        }
    });

    test("does not treat a public host inside a private-looking range as private", () => {
        expect(isPrivateCDNHost("172.32.0.1")).toBe(false);
        expect(isPrivateCDNHost("11.0.0.1")).toBe(false);
        expect(isPrivateCDNHost("192.169.1.1")).toBe(false);
        expect(isPrivateCDNHost("999.1.1.1")).toBe(false);
    });
});

describe("CDN viewer auth validation", () => {
    test("offers auth types only for supported providers", () => {
        expect(supportsCDNViewerAuth("aliyun")).toBe(true);
        expect(supportsCDNViewerAuth("tencent")).toBe(true);
        expect(supportsCDNViewerAuth("qiniu")).toBe(false);
        expect(supportsCDNViewerAuth("s3")).toBe(false);
        expect(getCDNAuthTypeOptions("aliyun").map((option) => option.value)).toEqual(["", "aliyun_a", "aliyun_b", "aliyun_c"]);
        expect(getCDNAuthTypeOptions("tencent").map((option) => option.value)).toEqual(["", "tencent_a", "tencent_d"]);
    });

    test("rejects an auth type belonging to another provider", () => {
        expect(isValidCDNAuthType("aliyun", "aliyun_b")).toBe(true);
        expect(isValidCDNAuthType("aliyun", "tencent_d")).toBe(false);
        expect(isValidCDNAuthType("qiniu", "aliyun_a")).toBe(false);
        expect(isValidCDNAuthType("aliyun", "")).toBe(true);
    });

    test("requires domain, auth type and key together", () => {
        const base = { provider: "aliyun" as const, cdnBaseUrl: "https://media.example.com", cdnAuthType: "aliyun_a", hasAuthKey: true };
        expect(validateCDNViewerAuth(base)).toBe("");
        expect(validateCDNViewerAuth({ ...base, cdnBaseUrl: "" })).toContain("CDN 加速域名");
        expect(validateCDNViewerAuth({ ...base, hasAuthKey: false })).toContain("鉴权密钥");
        expect(validateCDNViewerAuth({ ...base, cdnAuthType: "" })).toContain("鉴权方式");
        expect(validateCDNViewerAuth({ ...base, cdnAuthType: "tencent_a" })).toContain("不支持");
    });

    test("allows CDN without viewer auth to fall back to an origin signature", () => {
        expect(validateCDNViewerAuth({ provider: "aliyun", cdnBaseUrl: "https://media.example.com", cdnAuthType: "", hasAuthKey: false })).toBe("");
        expect(validateCDNViewerAuth({ provider: "qiniu", cdnBaseUrl: "https://media.example.com", cdnAuthType: "", hasAuthKey: false })).toBe("");
    });
});
