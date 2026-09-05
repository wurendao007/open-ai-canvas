import { useCopyText } from "@/hooks/use-copy-text";
import { ArrowRight, Check, Copy, ExternalLink, GitBranch, ShieldCheck, Terminal, Zap } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";

import "./cli.css";

const LOGIN_COMMAND = "kraftreel login web";
const CODEX_COMMAND = "codex mcp add kraftreel -- kraftreel mcp";
const CLAUDE_COMMAND = "claude mcp add --scope user --transport stdio kraftreel -- kraftreel mcp";
const HOSTED_SERVER_URL = "https://kraftreel.com";
const AGENT_INSTALL_PROMPT = `请帮我安装 KraftReel Skill：
${HOSTED_SERVER_URL}/cli/latest/kraftreel-cli-skill.zip
下载并安装这个 Skill 包，执行包内对应系统的安装脚本，完成 KraftReel CLI 与远程 MCP 初始化，不要启用本机 Runtime 或 Dreamina CLI。
安装后告诉我如何完成网页登录授权。`;
const INSTALL_SCRIPT_URL = `${HOSTED_SERVER_URL}/cli/latest/install-kraftreel-cli`;

export default function KraftReelCliPage() {
    const copyText = useCopyText();
    const [installMode, setInstallMode] = useState<"agent" | "manual">("agent");

    return (
        <main className="kraftreel-cli-page">
            <header className="kraftreel-cli-header">
                <Link to="/" className="kraftreel-cli-brand" aria-label="返回 KraftReel 首页">
                    <span className="kraftreel-cli-brand-mark" aria-hidden="true"><Terminal className="size-4" /></span>
                    <span>KraftReel</span>
                    <span className="kraftreel-cli-brand-divider" aria-hidden="true">/</span>
                    <span className="kraftreel-cli-brand-product">CLI</span>
                </Link>
                <nav className="kraftreel-cli-nav" aria-label="页面导航">
                    <a href="#install">安装</a>
                    <a href="#mcp">MCP</a>
                    <Link to="/login?next=%2F">登录</Link>
                </nav>
            </header>

            <div className="kraftreel-cli-shell">
                <section className="kraftreel-cli-hero" aria-labelledby="kraftreel-cli-title">
                    <div className="kraftreel-cli-hero-copy">
                        <p className="kraftreel-cli-kicker"><Zap className="size-3.5" /> REMOTE CANVAS TOOLCHAIN</p>
                        <h1 id="kraftreel-cli-title">一行指令，让 KraftReel 进入你的 Agent 工作流</h1>
                        <p className="kraftreel-cli-lede">让你的 Agent 直接进入远程画布。安装 KraftReel Skill 后，通过 HTTPS 登录、选择项目，再用 MCP 读取和编辑创作流程。</p>
                        <div className="kraftreel-cli-hero-actions">
                            <a className="kraftreel-cli-button kraftreel-cli-button-primary" href="#install">开始安装 <ArrowRight className="size-4" /></a>
                            <Link className="kraftreel-cli-button kraftreel-cli-button-quiet" to="/login?next=%2F">进入 KraftReel <ExternalLink className="size-3.5" /></Link>
                        </div>
                        <div className="kraftreel-cli-facts" aria-label="运行特性">
                            <span><Check className="size-3.5" /> Skill 自动安装</span>
                            <span><Check className="size-3.5" /> HTTPS 远程连接</span>
                            <span><Check className="size-3.5" /> 不启动本机 Runtime</span>
                        </div>
                    </div>

                    <div className="kraftreel-cli-terminal" aria-label="KraftReel CLI 连接预览">
                        <div className="kraftreel-cli-terminal-bar"><span /><span /><span /><b>kraftreel</b></div>
                        <div className="kraftreel-cli-terminal-body">
                            <p><i>$</i> kraftreel login web</p>
                            <p className="is-muted">正在打开安全网页登录…</p>
                            <p className="is-success"><Check className="size-3.5" /> 设备已授权</p>
                            <p><i>$</i> kraftreel project use film-2026</p>
                            <p className="is-success"><Check className="size-3.5" /> 已连接远程画布</p>
                            <div className="kraftreel-cli-terminal-rule" />
                            <dl>
                                <div><dt>transport</dt><dd>stdio / MCP</dd></div>
                                <div><dt>endpoint</dt><dd>HTTPS</dd></div>
                                <div><dt>scope</dt><dd>canvas:read · write · generate</dd></div>
                            </dl>
                        </div>
                    </div>
                </section>

                <section id="install" className="kraftreel-cli-section" aria-labelledby="install-title">
                    <div className="kraftreel-cli-section-heading">
                        <p className="kraftreel-cli-section-index">01 / GET STARTED</p>
                        <h2 id="install-title">安装 CLI</h2>
                        <p>选择“通过 AI Agent 安装”或“手动安装”，完成 Skill、CLI 和远程 MCP 初始化。</p>
                    </div>
                    <div className="kraftreel-cli-install-tabs" role="tablist" aria-label="安装方式">
                        <button type="button" role="tab" aria-selected={installMode === "agent"} className={installMode === "agent" ? "is-active" : ""} onClick={() => setInstallMode("agent")}>通过 AI Agent 安装</button>
                        <button type="button" role="tab" aria-selected={installMode === "manual"} className={installMode === "manual" ? "is-active" : ""} onClick={() => setInstallMode("manual")}>手动安装</button>
                    </div>
                    {installMode === "agent" ? (
                        <div className="kraftreel-cli-install-panel">
                            <p className="kraftreel-cli-install-lede">将下面这段话直接发给你的 AI 助手，它会自动下载并安装 Skill 包。</p>
                            <CommandBlock label="提示词" code={AGENT_INSTALL_PROMPT} onCopy={copyText} />
                        </div>
                    ) : (
                        <div className="kraftreel-cli-install-panel">
                            <p className="kraftreel-cli-install-lede">依次完成安装和登录。KraftReel 公网服务已内置，无需设置服务地址。</p>
                            <div className="kraftreel-cli-manual-grid">
                                <CommandBlock label="macOS / Linux" code={`curl -fsSL ${INSTALL_SCRIPT_URL}.sh | bash`} onCopy={copyText} />
                                <CommandBlock label="Windows（PowerShell）" code={`irm ${INSTALL_SCRIPT_URL}.ps1 | iex`} onCopy={copyText} />
                                <CommandBlock label="Windows（CMD）" code={`curl -fsSL ${INSTALL_SCRIPT_URL}.cmd -o install-kraftreel-cli.cmd && install-kraftreel-cli.cmd`} onCopy={copyText} />
                            </div>
                        </div>
                    )}
                    <div className="kraftreel-cli-followup-grid">
                        <article className="kraftreel-cli-step">
                            <div className="kraftreel-cli-step-number">01</div>
                            <div><h3>网页登录</h3><p>推荐使用网页登录，批准设备后会自动同步到 CLI。</p></div>
                            <CommandBlock label="终端" code={LOGIN_COMMAND} onCopy={copyText} />
                        </article>
                        <article className="kraftreel-cli-step">
                            <div className="kraftreel-cli-step-number">02</div>
                            <div><h3>选择画布</h3><p>列出项目并保存当前 MCP 操作目标。</p></div>
                            <CommandBlock label="终端" code={'kraftreel project list\nkraftreel project use <canvas-project-id>'} onCopy={copyText} />
                        </article>
                    </div>
                </section>

                <section id="mcp" className="kraftreel-cli-section kraftreel-cli-mcp-section" aria-labelledby="mcp-title">
                    <div className="kraftreel-cli-section-heading">
                        <p className="kraftreel-cli-section-index">02 / MCP HOSTS</p>
                        <h2 id="mcp-title">接入你的 Agent</h2>
                        <p>插件安装后，宿主会按需获取 CLI 并加载 KraftReel MCP 工具，不需要全局安装 npm 包。</p>
                    </div>
                    <div className="kraftreel-cli-host-grid">
                        <CommandBlock label="Codex CLI" code={CODEX_COMMAND} onCopy={copyText} />
                        <CommandBlock label="Claude Code" code={CLAUDE_COMMAND} onCopy={copyText} />
                    </div>
                    <div className="kraftreel-cli-note">
                        <ShieldCheck className="size-5" aria-hidden="true" />
                        <p>删除、覆盖、移动、改边和生成由 MCP 宿主审批。服务端仍会校验登录态、画布归属、版本号、状态哈希和审计权限。</p>
                    </div>
                </section>

                <footer className="kraftreel-cli-footer">
                    <span>KraftReel CLI · Remote canvas MCP</span>
                    <a href="https://github.com/wurendao007/open-ai-canvas" target="_blank" rel="noreferrer"><GitBranch className="size-3.5" /> 源码 <ExternalLink className="size-3" /></a>
                </footer>
            </div>
        </main>
    );
}

function CommandBlock({ label, code, onCopy }: { label: string; code: string; onCopy: (value: string, successText?: string) => void }) {
    return (
        <div className="kraftreel-cli-command">
            <div className="kraftreel-cli-command-head"><span>{label}</span><button type="button" onClick={() => onCopy(code, "命令已复制")} aria-label={`复制 ${label} 命令`}><Copy className="size-3.5" /> 复制</button></div>
            <pre><code>{code}</code></pre>
        </div>
    );
}
