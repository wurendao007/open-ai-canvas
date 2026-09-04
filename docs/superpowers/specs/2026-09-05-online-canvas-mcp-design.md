# 在线 Canvas MCP 架构设计

## 状态与决策范围

状态：待用户审阅。

本设计针对“完全移除 `local-runtime`，保留画布网页中的在线 Agent 和画布 MCP 工具”的架构变更。目标是让 Codex 等 MCP 宿主通过 HTTPS 访问后端画布能力，不再依赖 `127.0.0.1:17371`、本机 Canvas SSE 会话、Dreamina 本机 CLI 或肖像排查本机引擎。

本设计不改变当前网页在线 Agent 的产品路径：网页在线 Agent 继续使用现有后端任务/模型协议，在浏览器内基于当前画布状态生成并应用操作。外部 MCP 是独立入口，由 MCP 宿主负责工具审批；删除、覆盖、移动、改边和触发生成不再要求画布网页额外弹窗确认。

## 已核实的现状

以下结论来自当前工作区代码，而不是历史假设：

- `canvas-agent/src/mcp-server.ts` 目前把工具 POST 到 `${config.url}/api/tools`，并依赖本机 token。
- `canvas-agent/src/config.ts` 的默认地址是 `http://127.0.0.1:17371`，配置模型仍是 Local Runtime 配置。
- `canvas-agent/src/index.ts` 在非 `mcp` 模式启动 `startLocalRuntime()`。
- `canvas-agent/src/local-runtime-host.ts` 仍注册 Canvas Agent、Dreamina 和肖像排查模块。
- `canvas-agent/src/canvas-session.ts` 把画布状态保存在进程内存，通过 SSE `openEvents` 接收网页状态，再通过 `tool_call` 事件请求网页执行写操作。
- 网页已有 `canvas-agent-ops`、`canvas-agent-context` 和 `CanvasProject` 持久化链路，能表达节点、连线、选区、视口、资源引用、生成任务和本地 revision。
- 后端已有 Cookie 登录、`GET/PUT/DELETE /api/canvas-projects/:id`、画布归属校验、资源引用校验、任务创建和审计基础能力。
- `CanvasProject` 当前只保存 payload、标题、用户和更新时间；服务端尚无独立的 MCP 令牌、服务端 revision 或规范化状态哈希合同。

## LibTV CLI 的参考边界

已检查 `https://www.liblib.tv/cli`。该页面实际是 LibTV CLI/Skill 文档，不是 MCP 协议规范，因此只参考其公开的交互边界，不推断其内部 MCP 实现：

- 登录通过网页完成，凭据由 CLI 保存到用户配置目录。
- `project use <画布 UUID>` 把当前画布写入项目目录配置文件，后续命令直接操作远程画布。
- 节点删除、更新、连线和移动没有文档要求网页二次确认；TTY 交互主要用于同名节点消歧。
- 文档没有公开 `confirm`、`approval`、`--force` 或危险操作网页确认规则。

因此本方案采用“网页登录 + 远程项目选择 + MCP 宿主审批”的公开模式，但不复制任何未公开的 LibTV 内部协议，也不写入其演示密钥或固定域名。

## 目标

- MCP 工具通过登录态后端读取和修改远程 CanvasProject。
- MCP 客户端不启动本机 HTTP Runtime，不访问 `127.0.0.1:17371`，不建立浏览器 SSE 画布会话。
- 令牌可以网页配对、刷新、撤销；数据库只保存哈希和必要的审计信息。
- 每次写操作都由后端校验用户、画布归属、操作参数、`expectedRevision` 和 `expectedStateHash`，避免基于过期状态覆盖他人修改。
- 外部 MCP 与网页在线 Agent 使用同一份服务端画布数据合同，生成任务复用现有后端任务链路。
- 删除、覆盖、移动、改边、选区、视口和生成的语义可被 MCP 工具稳定调用并可测试。
- 移除 Local Runtime、Dreamina 本机模块、肖像排查本机模块及其设置、测试和文档入口，不引入兼容层。

## 非目标

- 不把网页在线 Agent 改造成 MCP 宿主，也不把网页 UI 操作转发给远程 MCP。
- 不通过后端文件流代理媒体；MCP 只返回资源 ID、存储键摘要和就绪状态，不返回媒体 URL、API Key 或 data URL。
- 不实现多用户协作冲突合并、CRDT、历史版本回滚或离线写队列；冲突返回后由调用方重新读取上下文再重试。
- 不保留旧的 `/api/tools` 本机 Runtime 协议，不为旧配置自动迁移出新的本地服务。
- 不要求画布网页为外部 MCP 写操作弹窗；MCP 宿主的工具审批是唯一交互确认边界。

## 方案比较与选择

### 方案 A：保留本机 Runtime，网页继续 SSE 连接

优点是改动最小，现有 `CanvasSession` 可继续复用。缺点是无法满足“完全移除 local-runtime”，会继续产生 `127.0.0.1:17371` 循环连接、端口占用、浏览器来源校验和本机能力安全边界；远程 MCP 也无法在没有同一台机器和浏览器的情况下工作。

结论：否决。

### 方案 B：MCP 客户端读取画布后在本机改 JSON，再调用通用 PUT

优点是后端新增代码少。缺点是服务端无法验证每个操作的节点/连线语义，恶意客户端可以提交任意 payload；生成、资源引用、审计和并发检查容易与网页路径分叉。

结论：否决。

### 方案 C：stdio MCP 适配器 + 后端在线 Canvas MCP API（推荐）

`@ddcat666/open-ai-canvas-agent mcp` 继续作为 MCP 宿主需要的 stdio 进程，但它只做远程 HTTPS 适配：读取本地 CLI 凭据和 `.yingce/project.json`，调用后端 MCP API，把结果转换为 MCP 文本响应。后端实现认证、项目选择、操作解析、并发校验、任务提交和审计。网页在线 Agent 与外部 MCP 共享同一 CanvasProject 服务合同，但互不建立本机连接。

该方案保留当前插件的 `command` 配置形状，兼容 Codex 对 stdio MCP 的使用方式，同时移除端口 `17371` 和浏览器 SSE 依赖；写入权限和数据归属集中在后端，便于审计和后续扩展其他 MCP 宿主。

## 总体架构

```text
Codex / MCP Host
        │ stdio
        ▼
yingce mcp adapter (Node, 无 HTTP 监听)
        │ HTTPS Bearer access token
        ▼
Backend /api/mcp/*
   ├── MCP Auth Service（设备登录、刷新、撤销）
   ├── MCP Project Service（list/use、归属、摘要）
   ├── Canvas MCP Tool Service（读、校验、写、生成）
   ├── CanvasProject Repository（revision + stateHash 原子更新）
   └── Task/Resource/Audit services
        ▲
        │ HTTPS Cookie / apiClient
Canvas Web ── 在线 Agent、普通编辑和自动保存
```

Node 适配器进程本身不是 Local Runtime：它不监听端口、不保存画布状态、不注册 Dreamina/肖像模块、不读取浏览器状态，也不向网页发 SSE。它只负责 MCP stdio 生命周期和后端 API 调用。

## 认证与令牌生命周期

### 网页设备登录

CLI 命令为 `yingce login web`（实际 npm 包入口仍由 `canvas-agent` 提供）：

1. CLI 调用 `POST /api/mcp/auth/device` 创建一次性设备会话，提交随机 `deviceCode` 的哈希、客户端名称、请求 scope 和过期时间。
2. 后端返回短的 `userCode`、过期时间和网页 URL；CLI 打开网页 URL，不启动 localhost 回调服务器。
3. 用户在已经登录的影策网页中访问 `/mcp/device?code=...`。页面显示客户端名称、请求权限和有效期；用户确认后调用带 Cookie 的审批接口。
4. CLI 轮询 `POST /api/mcp/auth/device/token`。审批完成后后端一次性返回 access token 和 refresh token，并立即消费设备会话。
5. CLI 将凭据保存到 `~/.yingce/credentials.json`，文件权限限定为当前用户可读；文件中不保存画布 payload。

设备会话有效期为 10 分钟，`deviceCode` 和 `userCode` 均只允许使用一次。未审批、拒绝、过期和已消费状态分别返回明确状态，CLI 不无限轮询。

### 令牌存储和刷新

- access token 有效期 15 分钟，仅通过 `Authorization: Bearer` 传递，不放入 URL、日志或画布 JSON。
- refresh token 有效期 30 天，数据库只保存哈希、用户 ID、客户端名称、scope、创建/最后使用/撤销时间和 token 家族 ID。
- 刷新采用轮换：旧 refresh token 立即失效并生成新 token；检测到已轮换 token 重放时撤销整个 token 家族。
- `POST /api/mcp/auth/revoke` 撤销当前 refresh token 家族；网页账户登出不自动撤销已签发的 MCP token，用户可在安全设置中单独撤销。
- 认证失败统一使用 401；scope 不足使用 403；过期或重放不泄漏 token 是否存在的额外信息。

建议表名为 `mcp_device_sessions`、`mcp_tokens`，模型加入 `database.Models()` 和迁移；token secret、refresh secret 只存在哈希，不写审计正文。

## 项目选择合同

CLI 在当前工作目录保存 `.yingce/project.json`：

```json
{
  "serverUrl": "https://canvas.example.com",
  "canvasProjectId": "canvas-uuid",
  "selectedAt": "2026-09-05T00:00:00Z"
}
```

支持：

- `yingce project list` → `GET /api/mcp/projects`，只返回当前用户有权访问的画布摘要。
- `yingce project use <canvasProjectId>` → 先调用 `GET /api/mcp/projects/:id` 校验归属和可读性，再写入 `.yingce/project.json`。
- `yingce project unuse` → 删除当前目录配置，不影响服务端画布。
- MCP 工具的 `canvasProjectId` 为可选字段；省略时使用 `.yingce/project.json`，显式传入时必须属于当前 token 用户。

项目文件不保存 access/refresh token；多个目录可以选择同一画布，服务端并发合同负责防止互相覆盖。

## 在线 MCP API

所有成功响应继续使用项目统一业务外壳 `{ code: 0, data, msg }`；MCP 适配器解包后返回工具 JSON。所有接口均要求 Bearer access token，除设备创建、网页审批和设备轮询外不使用 Cookie。

### 认证接口

```text
POST /api/mcp/auth/device
POST /api/mcp/auth/device/token
POST /api/mcp/auth/device/:id/approve
POST /api/mcp/auth/refresh
POST /api/mcp/auth/revoke
```

### 画布接口

```text
GET  /api/mcp/projects
GET  /api/mcp/projects/:id
POST /api/mcp/projects/:id/tools/validate
POST /api/mcp/projects/:id/tools/apply
POST /api/mcp/projects/:id/tools/generate
```

`GET /api/mcp/projects/:id` 返回：

```json
{
  "project": { "id": "...", "title": "...", "nodes": [], "connections": [], "viewport": {}, "selectedNodeIds": [] },
  "revision": 12,
  "stateHash": "sha256-base64url",
  "hashSource": "server"
}
```

`validate` 和 `apply` 接受：

```json
{
  "ops": [],
  "expectedRevision": 12,
  "expectedStateHash": "sha256-base64url"
}
```

服务端先规范化 payload，再对规范化状态计算 SHA-256 stateHash。`apply` 使用数据库事务或带条件的更新：只有数据库中的 revision 和 stateHash 同时匹配 expected 值时才提交下一 revision；不匹配返回 409，并带当前 revision/stateHash，不部分执行 ops。

## 工具语义

MCP 工具名称继续沿用现有 `canvas_*` 合同，以便网页在线 Agent、插件 skill 和外部 MCP 保持一致。读工具不改变状态；写工具都必须走服务端校验和审计。

### 读工具

- `canvas_get_state`、`canvas_export_snapshot`：返回安全的完整画布快照，不返回媒体 URL 和密钥。
- `canvas_get_context`：返回语义化节点、连线、选区、资源就绪状态、`revision`、`stateHash` 和 `hashSource=server`。
- `canvas_find_nodes`、`canvas_get_node`、`canvas_get_connection`：只返回当前画布真实 ID 和安全 metadata。
- `canvas_get_generation_tasks`：读取已绑定任务的持久化观察状态，不主动轮询第三方上游。
- `canvas_get_resources`：返回资源 ID、类型、尺寸、大小、时长、storage key 摘要和 `ready`，不返回可直接下载的 URL。
- `canvas_get_selection`：返回服务端快照中的 selected node IDs 对应节点。

### 校验和写工具

- `canvas_validate_ops`：在不写入数据库的情况下解析全部 ops，检查节点/连线存在性、ID 重复、坐标和尺寸范围、连接自环、资源引用和生成模式；返回 issues、operationCount、当前 revision/stateHash。
- `canvas_apply_ops`：按输入顺序在内存副本上应用全部操作，全部通过后一次性写入；支持 `add_node`、`update_node`、`delete_node`、`delete_connections`、`connect_nodes`、`set_viewport`、`select_nodes`、`run_generation`。
- 语义化创建/移动/删除/连线工具继续由适配器转换为同一 ops 合同，后端不维护第二套隐式规则。
- `canvas_create_workflow`、`canvas_create_generation_flow` 和 `canvas_generate_*` 先生成规范 ops，再走 validate/apply；不得直接绕过 revision 检查。

### 破坏性操作与确认边界

- 删除节点会在同一事务中删除相关连线；覆盖是 `update_node` 的明确 metadata/patch 更新；移动和改边只影响指定 ID；不会隐式删除其他节点或媒体资源。
- 删除、覆盖、移动、改边、选区、视口和生成不弹出画布网页确认框。MCP 宿主负责工具审批；后端负责权限、并发、审计和参数校验。
- 若调用方没有传 expected revision/stateHash，服务端对写操作返回 428 `precondition_required`，要求先读取 `canvas_get_context`。这样避免“最后写入者获胜”覆盖网页编辑。
- 生成操作只提交现有任务链路并回写节点 taskId/status；工具结果明确区分“已提交/生成中”和“已完成且资源就绪”。

## 后端服务边界

新增 `backend/internal/handler/mcp_canvas.go` 只负责路由、Bearer 身份解析、JSON 入参和统一错误响应。业务逻辑放入：

- `backend/internal/service/mcp_auth.go`：设备会话、token 哈希、轮换、撤销、scope。
- `backend/internal/service/mcp_canvas.go`：项目列表、归属检查、快照输出、读工具。
- `backend/internal/service/mcp_canvas_ops.go`：ops schema、验证、规范化、事务应用和审计。
- `backend/internal/repository/mcp.go`：设备会话/token 查询、条件更新、审计查询。
- `backend/internal/model/models_mcp.go`：MCP 设备会话、令牌和必要的审计结构。

MCP service 通过现有 `Service` 的任务、资源、画布和用户权限能力执行，不从 handler 直接查询数据库。管理员不能通过 MCP token 越权访问其他用户画布；每次项目读取和写入都以 token 的 user ID 为 scope。

## 画布数据与并发控制

`CanvasProject` 增加服务端字段 `Revision int64` 和 `StateHash string`。旧记录迁移时以规范化 payload 计算初始 hash，revision 从 0 开始；首次 MCP 写入递增到 1。现有网页 PUT 保存路径同步接受可选 `expectedRevision`/`expectedStateHash`，并返回新的 revision/stateHash；未提供时保留网页现有读取/保存行为，但 MCP 写路径始终强制提供。

规范化规则固定为：解析 JSON 对象，保留画布公共字段和节点/连线顺序，去掉服务端不持久化的临时字段，再使用稳定键排序序列化后计算 SHA-256。前端本地 storage revision 与服务端 CanvasProject revision 不混用；在线 Agent 读取服务端返回的 hash 时必须标记 `hashSource=server`。

服务端写入流程：

```text
读取用户画布
  → 检查 expectedRevision/stateHash
  → 在副本上 validate 全部 ops
  → 应用 ops、校验资源/任务引用
  → 递增 revision、计算 stateHash
  → 条件更新 CanvasProject + 审计记录
  → 返回 snapshot、verification、revision、stateHash
```

任何一步失败都回滚事务，不产生部分节点、孤立连线或错误的生成任务记录。409 冲突不自动重试，调用方必须重新读取上下文。

## 网页在线 Agent 边界

- 保留 `web/src/components/canvas/canvas-assistant-panel.tsx` 的在线会话、后端任务和网页确认逻辑。
- 保留 `web/src/pages/canvas/use-canvas-agent-operations.ts`、`web/src/lib/canvas/canvas-agent-ops.ts`、`web/src/lib/canvas/canvas-agent-context.ts` 作为网页本地状态和操作预览实现。
- 网页保存画布时同步服务端 revision/stateHash；服务端冲突显示“画布已被其他窗口或 MCP 修改，请重新加载/合并”，不静默覆盖。
- 网页不读取 `agentUrl`、`agentToken`、Local Runtime 状态，也不探测 `127.0.0.1:17371`。

## 完全移除 Local Runtime

代码移除或改写范围：

- 删除 `canvas-agent/src/local-runtime.ts`、`local-runtime-host.ts`、`local-runtime-session.ts`、`modules/canvas-agent-http.ts`、Dreamina/肖像本机 HTTP 模块和仅供 Runtime 使用的依赖。
- `canvas-agent/src/index.ts` 只保留 `mcp` stdio 入口；无参数启动不再监听端口，改为输出 CLI 帮助并返回非零状态。
- `canvas-agent/src/config.ts` 改为远程服务器、凭据目录和项目选择配置，不再出现 `LOCAL_RUNTIME_DEFAULT_PORT`、`FRAMEFIELD_LOCAL_RUNTIME_CONFIG_DIR`、trusted browser origins 或 master token。
- `canvas-agent/src/mcp-server.ts` 改为调用 `/api/mcp/*`，加入 access token 刷新、401 重试一次和 409/428 结构化错误；不再调用 `/api/tools`。
- `plugins/yingce/.mcp.json` 保留 stdio command，但 README、skill 和帮助文本改为说明 `yingce login web`、`project use` 和远程 MCP；删除本机 Runtime、Dreamina CLI、肖像排查安装说明。
- 删除或迁移 `canvas-agent` 和 `web/test` 中只验证 Local Runtime、自动连接、本机 Dreamina、肖像排查本机引擎的测试；新增远程 MCP 认证、项目选择、工具 API 和无本机端口回归测试。
- 文档同步 `canvas-agent/README.md`、`plugins/yingce/README.md`、相关 skills、后端 API 文档和数据库文档，明确“stdio 适配器 ≠ Local Runtime”。

ComfyUI Bridge 若仍属于当前产品能力，单独保留为后端主动投递的远程 Bridge；它不属于 Canvas MCP，也不允许重新引入 `127.0.0.1:17371` 画布会话。Dreamina 本机 CLI 和肖像排查本机引擎不再提供。

## 错误、断线与恢复

- 401：access token 过期或撤销；适配器先使用 refresh token 轮换一次，失败则提示重新 `login web`。
- 403：scope 或画布归属不足；不重试。
- 404：画布、节点或连线不存在；返回稳定错误码和目标 ID。
- 409：revision/stateHash 冲突、refresh token 重放或重复连线；返回当前状态摘要或重新登录提示。
- 428：写操作缺少 `expectedRevision`/`expectedStateHash`。
- 422：ops 参数、资源引用或生成参数不合法。
- 429：设备轮询、token 刷新、MCP 写操作或任务提交超限；适配器遵守 `Retry-After`，不无限重试。
- 5xx/网络断线：读操作可由调用方重新读取；写操作不自动重放，除非服务端返回明确幂等键已确认。

生成请求使用调用方提供或适配器生成的 idempotency key，后端任务服务保证同一用户、画布、节点和请求指纹不会重复扣费或创建重复任务。

## 审计与安全

- 每次 MCP 登录审批、刷新、撤销、项目读取、validate、apply、生成和失败写入都记录 user ID、token family ID、画布 ID、工具名、operationCount、revision 前后值、结果码和 request ID。
- 审计中禁止记录 access/refresh token、Cookie、API Key、媒体 URL、完整 prompt 中的敏感凭据和原始大 payload；ops 仅保留安全摘要。
- 默认拒绝本机、私网和链路本地上游；MCP API 不接受客户端指定上游 URL。
- Bearer token 只通过 HTTPS 传输；生产 CORS、Cookie 和数据目录遵循现有安全约束。

## 数据库与文档迁移

- 在 `backend/internal/model/models_mcp.go` 新增设备会话、令牌和（如现有审计模型无法覆盖）MCP 调用审计模型。
- 在 `CanvasProject` 增加 `revision`、`state_hash`，迁移旧 payload 的规范化 hash；不修改历史 payload 内容。
- `backend/internal/database/schema.go` 的 Models 清单、迁移和 PostgreSQL/SQLite 行为必须同时更新。
- `docs/content/docs/backend/backend-database.mdx` 增加字段和索引说明；新增或变更的 `/api/mcp/*` 写入 `docs/content/docs/backend/` 对应 API 专题，而不是只写根 README。
- 旧 `local-runtime` 配置文件不会被读取或转换；启动旧命令不产生监听器，用户需执行 `login web` 获取远程凭据。

## 测试与验收标准

### Canvas Agent

- `npm test`：覆盖设备登录轮询状态、token 刷新/撤销、项目文件读写、401 一次刷新、409/428 错误映射和 MCP 工具 schema。
- `npm run build`：确认不再引入 Local Runtime 模块或 `127.0.0.1:17371` 字符串。
- 启动无参数命令不会监听端口；`mcp` 命令仅建立 stdio，不创建 HTTP server。

### 后端

- `go test ./...`：覆盖设备会话单次消费、refresh rotation/replay 撤销、用户和画布归属、scope、revision/stateHash 冲突、ops 全量回滚、删除连线、生成任务幂等和审计脱敏。
- SQLite 单元测试和 PostgreSQL 迁移/集成测试都验证 `CanvasProject` 新字段与 MCP 表索引。
- API 冒烟：未登录 401、错误用户 403/404、合法读取 200、无前置条件写入 428、过期状态写入 409、合法写入 revision +1。

### Web

- `cd web && bun run build`；相关在线 Agent 和画布保存专项测试必须通过。
- 浏览器 DOM/网络检查确认画布页面不会请求 `http://127.0.0.1:17371/runtime/info`、`/api/tools` 或读取 `agentUrl/agentToken`。
- 登录、在线 Agent、普通编辑、MCP 外部修改后的刷新/冲突提示、明暗主题和空态至少各验证一次。

验收以当前命令输出和浏览器网络证据为准；此前 Local Runtime 自动探测修复的测试结果不能直接作为本次架构改造的验证结论。

## 被否决的替代方案

- 继续让 MCP 进程持有内存中的 CanvasSession：无法跨设备、无法在后端重启后恢复，也违反完全移除本机能力的目标。
- 让网页把整个 payload 通过 MCP 传给客户端再覆盖：服务端无法执行细粒度权限和操作校验，容易造成资源引用丢失和最后写入者覆盖。
- 只把 `/api/tools` 地址从 localhost 改成公网：仍保留旧的内存会话协议、浏览器 SSE 和 token 语义，不能得到真正的在线项目级 MCP。

## 实施分阶段边界

实施计划应按以下可独立验证的阶段拆分：

1. 后端 MCP 数据模型、设备认证、项目读取和 revision/stateHash 合同。
2. 后端 Canvas MCP ops 验证/应用、生成任务接入和审计。
3. Node stdio 远程 MCP 适配器与 CLI `login web`/`project use`。
4. 网页保存冲突处理、MCP 登录审批页和移除本机 Runtime 入口。
5. 插件/文档/测试清理、前后端构建、浏览器网络验证和回归验收。
