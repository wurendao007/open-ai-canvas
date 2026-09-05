export type OSSProvider = "aliyun" | "tencent" | "qiniu" | "s3";

export type S3Preset = "aws" | "r2" | "b2" | "rustfs" | "custom";

export type CDNAuthType = "" | "aliyun_a" | "aliyun_b" | "aliyun_c" | "tencent_a" | "tencent_d";

const CDN_AUTH_TYPE_OPTIONS: Record<OSSProvider, Array<{ label: string; value: CDNAuthType }>> = {
    aliyun: [
        { label: "不启用", value: "" },
        { label: "鉴权方式 A（auth_key 查询参数）", value: "aliyun_a" },
        { label: "鉴权方式 B（路径中带分钟级时间戳）", value: "aliyun_b" },
        { label: "鉴权方式 C（路径中带十六进制时间戳）", value: "aliyun_c" },
    ],
    tencent: [
        { label: "不启用", value: "" },
        { label: "TypeA（sign 查询参数）", value: "tencent_a" },
        { label: "TypeD（sign 与 t 查询参数）", value: "tencent_d" },
    ],
    qiniu: [],
    s3: [],
};

export function getCDNAuthTypeOptions(provider: OSSProvider) {
    return CDN_AUTH_TYPE_OPTIONS[provider];
}

export function supportsCDNViewerAuth(provider: OSSProvider) {
    return getCDNAuthTypeOptions(provider).length > 0;
}

export function isValidCDNAuthType(provider: OSSProvider, authType: string) {
    if (!authType) return true;
    return getCDNAuthTypeOptions(provider).some((option) => option.value === authType);
}

export function validateCDNViewerAuth(input: { provider: OSSProvider; cdnBaseUrl: string; cdnAuthType: string; hasAuthKey: boolean }) {
    if (!isValidCDNAuthType(input.provider, input.cdnAuthType)) return "当前云厂商不支持所选的 CDN 鉴权方式";
    if (input.cdnAuthType && !input.cdnBaseUrl) return "启用 CDN 鉴权需要先填写 CDN 加速域名";
    if (input.cdnAuthType && !input.hasAuthKey) return "启用 CDN 鉴权需要填写 CDN 鉴权密钥";
    if (!input.cdnAuthType && input.hasAuthKey) return "请选择 CDN 鉴权方式";
    return "";
}

export const DEFAULT_OSS_PATH_PREFIX = "open-ai-canvas";

export type OSSConnectionTestInput = {
    provider: OSSProvider;
    s3Preset?: S3Preset;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    cdnAuthType: CDNAuthType;
    cdnAuthKey?: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret?: string;
    sessionToken?: string;
    pathPrefix: string;
    pathStyle?: boolean;
};

export type OSSConnectionTestDraft = Omit<Partial<OSSConnectionTestInput>, "provider"> & Pick<OSSConnectionTestInput, "provider">;

export type OSSConnectionTestResult = {
    ok: boolean;
    message?: string;
    testedAt?: string;
    testedDigest?: string;
};

export const S3_PRESET_OPTIONS: Array<{ label: string; value: S3Preset }> = [
    { label: "AWS S3", value: "aws" },
    { label: "Cloudflare R2", value: "r2" },
    { label: "Backblaze B2", value: "b2" },
    { label: "RustFS", value: "rustfs" },
    { label: "自定义", value: "custom" },
];

const S3_PRESET_HINTS: Record<S3Preset, { region: string; endpoint: string; help: string }> = {
    aws: {
        region: "us-east-1",
        endpoint: "https://s3.us-east-1.amazonaws.com",
        help: "填写 AWS 区域对应的 S3 服务根 URL。",
    },
    r2: {
        region: "auto",
        endpoint: "https://<account-id>.r2.cloudflarestorage.com",
        help: "Endpoint 使用 R2 控制台提供的账户级 S3 API 根 URL。",
    },
    b2: {
        region: "us-west-004",
        endpoint: "https://s3.us-west-004.backblazeb2.com",
        help: "Region 和 Endpoint 应与 Backblaze B2 Bucket 所在区域一致。",
    },
    rustfs: {
        region: "us-east-1",
        endpoint: "http://127.0.0.1:9000",
        help: "填写后端可访问的 RustFS S3 服务根 URL。",
    },
    custom: {
        region: "us-east-1",
        endpoint: "https://s3.example.com",
        help: "填写兼容 S3 API 的服务根 URL，不要包含 Bucket 或对象路径。",
    },
};

const CONNECTION_FIELDS = new Set(["provider", "s3Preset", "region", "endpoint", "cdnBaseUrl", "cdnAuthType", "cdnAuthKey", "bucket", "accessKeyId", "accessKeySecret", "sessionToken", "pathPrefix", "pathStyle"]);

export function getS3PresetHints(preset?: S3Preset) {
    return S3_PRESET_HINTS[preset || "custom"];
}

export function changesRequireOSSRetest(changedValues: Record<string, unknown>) {
    return Object.keys(changedValues).some((key) => CONNECTION_FIELDS.has(key));
}

export function normalizeOSSConnectionTestInput(input: OSSConnectionTestDraft): OSSConnectionTestInput {
    return {
        provider: input.provider,
        s3Preset: input.s3Preset || "custom",
        region: trimConnectionValue(input.region),
        endpoint: trimConnectionURL(input.endpoint),
        cdnBaseUrl: trimConnectionURL(input.cdnBaseUrl),
        cdnAuthType: (trimConnectionValue(input.cdnAuthType) || "") as CDNAuthType,
        cdnAuthKey: trimConnectionValue(input.cdnAuthKey),
        bucket: trimConnectionValue(input.bucket),
        accessKeyId: trimConnectionValue(input.accessKeyId),
        accessKeySecret: trimConnectionValue(input.accessKeySecret),
        sessionToken: trimConnectionValue(input.sessionToken),
        pathPrefix: (trimConnectionValue(input.pathPrefix) || DEFAULT_OSS_PATH_PREFIX).replace(/^\/+|\/+$/g, ""),
        pathStyle: input.pathStyle === true,
    };
}

function trimConnectionValue(value?: string) {
    return (value || "").trim();
}

function trimConnectionURL(value?: string) {
    return trimConnectionValue(value).replace(/\/+$/, "");
}

export function isValidCDNBaseURL(value: string) {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/, "")) return false;
    return parsed.protocol === "https:" || isPrivateCDNHost(parsed.hostname);
}

export function isPrivateCDNHost(hostname: string) {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
    if (!host.includes(".")) return true;
    const octets = host.split(".");
    if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
    const [first, second] = octets.map(Number);
    return first === 127 || first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}
