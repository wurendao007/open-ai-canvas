import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("plugin state switches", () => {
    test("uses a page-scoped green and neutral switch palette", () => {
        const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        // 插件页开关消费统一的主题开关合同（control-switch），不再维护脱离主题的固定色。
        expect(styles).toContain("--plugin-switch-checked-bg: var(--control-switch-checked-bg);");
        expect(styles).toContain("--plugin-switch-off-bg: var(--control-switch-off-bg);");
        // 浅色主题的开关色板：常态亮绿、悬停转深绿。
        expect(styles).toContain("--control-switch-checked-bg: #16a34a;");
        expect(styles).toContain("--control-switch-checked-hover-bg: #15803d;");
        // 深色主题的开关色板：亮绿态与中性灰态。
        expect(styles).toContain("--control-switch-checked-bg: #22c55e;");
        expect(styles).toContain("--control-switch-off-bg: #525252;");
        expect(styles).toContain(":where(.plugin-state-switch.ant-switch.ant-switch-checked)");
        expect(styles).toContain(":where(.plugin-state-switch.ant-switch:not(.ant-switch-checked))");
    });

    test("shows explicit state text on both plugin pages", () => {
        const userPage = readFileSync(resolve(import.meta.dir, "../src/pages/plugins/index.tsx"), "utf8");
        const adminPage = readFileSync(resolve(import.meta.dir, "../src/pages/admin/plugins/plugins-page.tsx"), "utf8");

        expect(userPage).toContain('className="plugin-state-switch"');
        expect(userPage).toContain('enabled ? "已启用" : "已停用"');
        expect(adminPage).toContain('className="plugin-state-switch"');
        expect(adminPage).toContain('label={available ? "已开放" : "已停用"}');
    });
});
