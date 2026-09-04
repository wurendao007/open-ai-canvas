import { useEffect, useState } from "react";
import { App, Button, Result, Typography } from "antd";
import { Check, ShieldCheck, X } from "lucide-react";
import { useSearchParams } from "react-router";

import { apiClient, request } from "@/services/api/request";

type ApprovalResult = {
    client_name: string;
    scope: string[];
    expires_at: string;
    status: string;
};

export default function MCPDevicePage() {
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const code = (params.get("code") || "").trim().toUpperCase();
    const [working, setWorking] = useState(false);
    const [result, setResult] = useState<ApprovalResult | null>(null);
    const [closed, setClosed] = useState(false);
    const [details, setDetails] = useState<ApprovalResult | null>(null);

    useEffect(() => {
        if (!code) return;
        void request<ApprovalResult>(apiClient.get(`/mcp/auth/device/${encodeURIComponent(code)}`))
            .then(setDetails)
            .catch(() => setClosed(true));
    }, [code]);

    const decide = async (approve: boolean) => {
        if (!code || working || result) return;
        setWorking(true);
        try {
            const data = await request<ApprovalResult>(apiClient.post(`/mcp/auth/device/${encodeURIComponent(code)}/approve`, { approve }));
            setResult(data);
            setClosed(!approve);
            message.success(approve ? "设备已批准" : "设备已拒绝");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "设备验证码无效或已过期");
            setClosed(true);
        } finally {
            setWorking(false);
        }
    };

    if (!code) {
        return <Result status="warning" title="设备验证码无效" subTitle="请从 MCP 客户端重新发起连接。" />;
    }
    if (closed || result?.status === "denied") {
        return <Result status="info" title="设备请求已关闭" subTitle="可以关闭此页面。" />;
    }
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-5 py-10">
            <section className="w-full space-y-6">
                <div className="space-y-2 text-center">
                    <ShieldCheck className="mx-auto size-10 text-primary" />
                    <Typography.Title level={2} className="!mb-0">批准 MCP 设备</Typography.Title>
                    <Typography.Paragraph type="secondary">确认此设备访问你的在线画布。</Typography.Paragraph>
                </div>
                <div className="space-y-3 rounded-lg border border-default bg-container p-5">
                    <div className="text-sm text-secondary">设备验证码</div>
                    <div className="break-all font-mono text-2xl tracking-widest">{code}</div>
                    <div className="text-sm text-secondary">客户端：{details?.client_name || "读取中..."}</div>
                    <div className="text-sm text-secondary">请求权限：{details?.scope?.join("、") || "读取中..."}</div>
                    <div className="text-sm text-secondary">有效期：{details ? new Date(details.expires_at).toLocaleString() : "读取中..."}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Button size="large" icon={<X className="size-4" />} disabled={working} onClick={() => void decide(false)}>拒绝</Button>
                    <Button type="primary" size="large" icon={<Check className="size-4" />} loading={working} disabled={!details} onClick={() => void decide(true)}>批准</Button>
                </div>
            </section>
        </main>
    );
}
