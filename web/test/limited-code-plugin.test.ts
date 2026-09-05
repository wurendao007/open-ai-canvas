import { describe, expect, test } from "bun:test";

import { createLimitedCodePlugin } from "../src/components/ai/limited-code-plugin";

describe("受限 Markdown 代码高亮插件", () => {
    test("只支持常用白名单语言及其别名", () => {
        const plugin = createLimitedCodePlugin();

        expect(plugin.supportsLanguage("javascript")).toBe(true);
        expect(plugin.supportsLanguage("js")).toBe(true);
        expect(plugin.supportsLanguage("TSX")).toBe(true);
        expect(plugin.supportsLanguage("py")).toBe(true);
        expect(plugin.supportsLanguage("unknown-language")).toBe(false);
        expect(plugin.supportsLanguage("cpp")).toBe(false);
        expect(plugin.supportsLanguage("c++")).toBe(false);
    });

    test("异步高亮返回 token，并复用相同代码块的并发任务", async () => {
        const plugin = createLimitedCodePlugin();
        const options = {
            code: "const answer = 42;",
            language: "js",
            themes: ["github-light", "github-dark"] as ["github-light", "github-dark"],
        };

        let firstResult: Awaited<Parameters<NonNullable<Parameters<typeof plugin.highlight>[1]>>[0]> | undefined;
        let secondResult: Awaited<Parameters<NonNullable<Parameters<typeof plugin.highlight>[1]>>[0]> | undefined;
        let resolveFirst: (() => void) | undefined;
        let resolveSecond: (() => void) | undefined;
        const firstDone = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });
        const secondDone = new Promise<void>((resolve) => {
            resolveSecond = resolve;
        });

        expect(
            plugin.highlight(options, (result) => {
                firstResult = result;
                resolveFirst?.();
            }),
        ).toBeNull();
        expect(
            plugin.highlight(options, (result) => {
                secondResult = result;
                resolveSecond?.();
            }),
        ).toBeNull();

        await Promise.all([firstDone, secondDone]);
        expect(firstResult?.tokens.length).toBeGreaterThan(0);
        expect(secondResult).toBe(firstResult);
    });

    test("不支持的语言返回纯文本回退，不调用高亮 callback", () => {
        const plugin = createLimitedCodePlugin();
        let called = false;

        expect(
            plugin.highlight(
                {
                    code: "int main() {}",
                    language: "cpp",
                    themes: ["github-light", "github-dark"],
                },
                () => {
                    called = true;
                },
            ),
        ).toBeNull();
        expect(called).toBe(false);
    });
});
