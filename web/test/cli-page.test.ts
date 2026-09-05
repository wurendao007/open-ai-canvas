import { expect, test } from "bun:test";

const page = await Bun.file(new URL("../src/pages/cli/index.tsx", import.meta.url)).text();
const styles = await Bun.file(new URL("../src/pages/cli/cli.css", import.meta.url)).text();
const router = await Bun.file(new URL("../src/router.tsx", import.meta.url)).text();
const providers = await Bun.file(new URL("../src/components/layout/app-providers.tsx", import.meta.url)).text();
const unixInstaller = await Bun.file(new URL("../../plugins/kraftreel/scripts/install-kraftreel-cli.sh", import.meta.url)).text();
const powershellInstaller = await Bun.file(new URL("../../plugins/kraftreel/scripts/install-kraftreel-cli.ps1", import.meta.url)).text();
const skillBuilder = await Bun.file(new URL("../scripts/build-kraftreel-cli-skill.mjs", import.meta.url)).text();

test("KraftReel CLI page is public and registered at /cli", () => {
    expect(router).toContain('const KraftReelCliPage = lazy(() => import("@/pages/cli"));');
    expect(router).toContain('{ path: "/cli", element: publicCliDeferred(<KraftReelCliPage />), errorElement: <RouteErrorPage /> }');
    expect(router).not.toContain('path: "/cli", element: <RequireAuth>');
    expect(providers).toContain('window.location.pathname === "/cli"');
    expect(providers).toContain("isolateDevRepro || isolatePublicCli");
});

test("KraftReel CLI page exposes install, login, and MCP commands", () => {
    expect(page).toContain("KraftReel CLI");
    expect(page).toContain("一行指令，让 KraftReel 进入你的 Agent 工作流");
    expect(page).toContain("KraftReel Skill");
    expect(page).toContain("自动安装");
    expect(page).toContain("通过 AI Agent 安装");
    expect(page).toContain("手动安装");
    expect(page).toContain("/cli/latest/kraftreel-cli-skill.zip");
    expect(page).toContain("INSTALL_SCRIPT_URL");
    expect(page).toContain("kraftreel-cli");
    expect(page).toContain("https://kraftreel.com");
    expect(page).toContain("kraftreel login web");
    expect(page).toContain("codex mcp add kraftreel");
    expect(page).toContain("claude mcp add");
    expect(page).toContain("onCopy={copyText}");
    expect(page).not.toContain("127.0.0.1:17371");
    expect(page).not.toContain("你的影策域名");
});

test("KraftReel CLI page links to generated and reproducible install assets", () => {
    expect(unixInstaller).toContain("npm install --global kraftreel-cli");
    expect(powershellInstaller).toContain("npm install --global kraftreel-cli");
    expect(skillBuilder).toContain("plugins/kraftreel");
    expect(skillBuilder).toContain("kraftreel-cli-skill.zip");
});

test("KraftReel CLI page keeps command blocks responsive and keyboard accessible", () => {
    expect(styles).toContain("@media (max-width: 860px)");
    expect(styles).toContain("@media (max-width: 560px)");
    expect(styles).toContain("white-space: pre-wrap");
    expect(styles).toContain("height: 100%;");
    expect(styles).toContain("min-height: 100dvh;");
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain("scrollbar-width: thin;");
    expect(styles).toContain(".kraftreel-cli-page::-webkit-scrollbar");
    expect(styles).toContain("width: 5px;");
    expect(page).toContain('type="button"');
    expect(page).toContain("aria-label={`复制 ${label} 命令`}");
});
