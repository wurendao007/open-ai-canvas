import { describe, expect, test } from "bun:test";

import { buildAssetDownloadFileName } from "../src/lib/asset-download";

describe("asset download file names", () => {
    test("preserves an asset original name that already has an extension", () => {
        expect(buildAssetDownloadFileName("Screenshot_20260819_224331.jpg", "jpg")).toBe("Screenshot_20260819_224331.jpg");
    });

    test("adds the media extension only when the asset name has none", () => {
        expect(buildAssetDownloadFileName("角色立绘", "png")).toBe("角色立绘.png");
    });

    test("sanitizes path separators without changing the extension decision", () => {
        expect(buildAssetDownloadFileName("原图/最终版.PNG", "png")).toBe("原图_最终版.PNG");
    });
});
