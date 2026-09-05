import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { AuthSessionHydrator } from "@/components/auth/auth-session-hydrator";
import { ClientRootInit } from "@/components/layout/client-root-init";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme } from "@/lib/skin-themes";
import { appQueryClient } from "@/lib/query-client";
import { useThemeStore } from "@/stores/use-theme-store";
import { applyAppearanceMetadata, useAppearanceStore } from "@/stores/use-appearance-store";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import { usePluginStore } from "@/stores/use-plugin-store";
import { fetchPluginRuntimeState, setUserPluginEnabled } from "@/services/api/plugins";
import { useUserStore } from "@/stores/use-user-store";

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";
    const appearance = useAppearanceStore((state) => state.appearance);
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);
    const setRuntimeStatuses = usePluginStore((state) => state.setRuntimeStatuses);
    const setPluginStates = usePluginStore((state) => state.setPluginStates);
    const pluginStoreHydrated = usePluginStore((state) => state.hydrated);
    const userId = useUserStore((state) => state.user?.id);

    useEffect(() => {
        if (!pluginStoreHydrated) return;
        for (const plugin of listRegisteredPlugins()) ensurePlugin(plugin.manifest);
    }, [ensurePlugin, pluginStoreHydrated, userId]);

    useEffect(() => {
        if (!userId) {
            setRuntimeStatuses({});
            setPluginStates({});
            return;
        }
        if (!pluginStoreHydrated) return;
        let cancelled = false;
        void fetchPluginRuntimeState()
            .then(async ({ statuses, states }) => {
                const legacyEnabledIds = usePluginStore
                    .getState()
                    .installations.filter((installation) => installation.enabled && states[installation.manifest.id]?.canToggle && !states[installation.manifest.id]?.userConfigured)
                    .map((installation) => installation.manifest.id);
                if (legacyEnabledIds.length) {
                    try {
                        const migrated = await Promise.all(legacyEnabledIds.map((pluginId) => setUserPluginEnabled(pluginId, true)));
                        for (const state of migrated) states[state.pluginId] = state;
                        for (const pluginId of legacyEnabledIds) statuses[pluginId] = states[pluginId]?.effectiveEnabled ? "enabled" : "disabled";
                    } catch (error) {
                        console.warn("迁移用户插件启用状态失败，已保留服务端状态", error);
                    }
                }
                if (!cancelled) {
                    setRuntimeStatuses(statuses);
                    setPluginStates(states);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRuntimeStatuses({});
                    setPluginStates({});
                }
            });
        return () => {
            cancelled = true;
        };
    }, [pluginStoreHydrated, setPluginStates, setRuntimeStatuses, userId]);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
        applySkinTheme(appearance.activeSkin, theme);
        applyAppearanceMetadata(appearance);
    }, [appearance, dark, theme]);

    // DEV 复现台和 CLI 文档页都不应被登录态、模型目录等工作区初始化阻塞：
    // 前者需要确定性本地场景，后者是公开的独立安装页。
    // 复现台条件在生产构建中会被摇树删除；CLI 条件保持公开页面可直接加载。
    const isolateDevRepro = import.meta.env.DEV && typeof window !== "undefined" && window.location.pathname === "/dev/director-repro";
    const isolatePublicCli = typeof window !== "undefined" && window.location.pathname === "/cli";

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark, appearance.activeSkin)}>
            <App message={{ duration: 3, maxCount: 3 }} notification={{ duration: 4.5, maxCount: 3, placement: "topRight" }}>
                <QueryClientProvider client={appQueryClient}>
                    {isolateDevRepro || isolatePublicCli ? (
                        children
                    ) : (
                        <AuthSessionHydrator>
                            <ClientRootInit>{children}</ClientRootInit>
                        </AuthSessionHydrator>
                    )}
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
