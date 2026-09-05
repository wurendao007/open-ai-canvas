import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("assets page batch toolbar", () => {
    test("places select all before cancel selection", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        // 按钮文案在 JSX 里独占一行，所以只匹配文案本身；断言要表达的是两者的先后顺序，
        // 而不是格式化方式。
        const selectAllIndex = source.indexOf("全选");
        const clearSelectionIndex = source.indexOf("取消选择");

        expect(selectAllIndex).toBeGreaterThanOrEqual(0);
        expect(clearSelectionIndex).toBeGreaterThanOrEqual(0);
        expect(selectAllIndex).toBeLessThan(clearSelectionIndex);
    });
});
