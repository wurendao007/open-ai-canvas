# 在线 Canvas MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 移除 Local Runtime 和本机画布会话，新增基于 HTTPS 后端的在线 Canvas MCP，并保持网页在线 Agent 可用。

**Architecture:** canvas-agent 仅作为无 HTTP 监听的 stdio MCP 适配器，使用设备网页登录取得的 Bearer token 调用后端 /api/mcp/*。后端集中负责 MCP 认证、画布归属、服务端 revision/stateHash、ops 校验/事务应用、生成任务和审计；网页在线 Agent 保持现有浏览器内在线路径，普通网页保存与 MCP 写入共用服务端并发合同。

**Tech Stack:** Go 1.25、Gin、GORM、SQLite/PostgreSQL、React 19、TypeScript 7、Vite、Bun、Node.js 18+、@modelcontextprotocol/sdk、Zod。

**Spec:** docs/superpowers/specs/2026-09-05-online-canvas-mcp-design.md

## Global Constraints

- 不启动或保留 127.0.0.1:17371 HTTP Runtime、浏览器 SSE 画布会话、Dreamina 本机 CLI 和肖像排查本机引擎。
- canvas-agent 的 mcp 命令只建立 stdio MCP 传输，不监听 HTTP 端口、不持有内存画布状态、不调用 /api/tools。
- 外部 MCP 的删除、覆盖、移动、改边和生成不弹出画布网页确认；工具审批由 MCP 宿主负责，后端负责权限、并发、审计和参数校验。
- 所有 MCP 写操作必须带 expectedRevision 和 expectedStateHash；缺失返回 HTTP 428，冲突返回 HTTP 409。
- MCP 令牌只保存哈希；access/refresh token、Cookie、API Key、媒体 URL 和大 payload 不进入日志、画布 JSON 或审计正文。
- 只修改本计划列出的文件；工作区现有未提交改动必须保留，不使用回滚或宽范围清理。
- 成功 API 仍使用 { code: 0, data, msg }；HTTP status 必须表达真实失败。

---

### Task 1: 公共数据合同、规范化哈希和数据库模型

**Files:**

- Create: backend/internal/model/models_mcp.go
- Modify: backend/internal/model/models_project.go:366-374
- Modify: backend/internal/database/schema.go:10-150
- Create: backend/internal/service/mcp_contract.go
- Create: backend/internal/service/mcp_contract_test.go
- Create: canvas-agent/src/remote-contract.ts
- Create: canvas-agent/test/remote-contract.test.ts

**Interfaces:**

- model.CanvasProject.Revision int64 和 StateHash string。
- service.CanvasMCPProject、CanvasMCPProjectSummary、CanvasMCPPrecondition。
- TypeScript RemoteCanvasEnvelope、RemoteCanvasProject、RemoteCanvasPrecondition。

- [ ] **Step 1: Extend CanvasProject without changing browser payload JSON.**

Add revision and state_hash fields with not-null defaults and indexes. Keep them outside PayloadJSON so existing CanvasProject JSON remains round-trippable.

- [ ] **Step 2: Add MCPDeviceSession and MCPToken.**

Store device/user-code hashes, client name, scopes, status, expiry, approval/consumption timestamps, token family ID, rotation and revocation timestamps. Add unique hash indexes and user/family/status/expiry indexes.

- [ ] **Step 3: Register models and backfill old hashes.**

Add models to database.Models(). During migration normalize each existing payload and set its initial state hash; preserve revision zero and never rewrite historical payload JSON.

- [ ] **Step 4: Implement deterministic hash functions.**

Expose:

~~~text
func NormalizeCanvasPayload(raw []byte) ([]byte, error)
func CanvasStateHash(raw []byte) (string, error)
~~~

Parse a JSON object, remove only an explicit allowlist of server-temporary fields, marshal with encoding/json, reject inline media data URLs, and return the complete SHA-256 digest encoded as unpadded base64url.

- [ ] **Step 5: Test and commit this slice.**

Test key-order stability, node-change sensitivity, invalid JSON/arrays, inline-media rejection and migration defaults.

~~~powershell
cd backend
go test ./internal/service -run 'TestCanvasStateHash|TestNormalizeCanvasPayload|TestMCPModel' -count=1
cd ..\canvas-agent
npm test -- --test-name-pattern='remote contract'
~~~

---

### Task 2: Backend MCP authentication and webpage device approval

**Files:**

- Create: backend/internal/repository/mcp.go
- Create: backend/internal/service/mcp_auth.go
- Create: backend/internal/service/mcp_auth_test.go
- Create: backend/internal/handler/mcp_auth.go
- Modify: backend/cmd/server/main.go:111-145
- Modify: web/src/router.tsx:80-220
- Create: web/src/pages/mcp/device.tsx
- Create: web/test/mcp-device-approval.test.ts

**Interfaces:**

- CreateMCPDeviceSession, ApproveMCPDeviceSession, ExchangeMCPDeviceToken, RefreshMCPToken, RevokeMCPToken.
- POST /api/mcp/auth/device, /device/token, /device/:id/approve, /refresh and /revoke.
- Browser approval route /mcp/device?code=<userCode>.
- RequireMCPToken(c, svc, requiredScope) returning MCPPrincipal.

- [ ] **Step 1: Implement device flow.**

Create a ten-minute device session with random device code and short user code. Return verification URI and polling interval. Polling returns pending/denied/expired, or atomically consumes an approved session once.

- [ ] **Step 2: Implement cookie-bound approval.**

The approval handler calls currentUser(c, svc), validates the user code and expiry, then records approve or deny. Never accept a user ID from JSON.

- [ ] **Step 3: Implement token rotation and scope checks.**

Access tokens last 15 minutes; refresh tokens last 30 days. Refresh rotates atomically; replaying a rotated refresh token revokes its whole family. Validate exact Bearer syntax, active user status and requested canvas:read/canvas:write/canvas:generate scope.

- [ ] **Step 4: Add approval UI and route registration.**

Register RegisterMCPAuthRoutes(api, svc). The page displays client/scopes/expiry and has approve/deny buttons; invalid or expired codes are non-actionable.

- [ ] **Step 5: Test and commit.**

Cover single-use exchange, unauthenticated approval, expiry, denial, rotation/replay revocation, disabled users, scope rejection and token non-disclosure.

~~~powershell
cd backend
go test ./internal/service ./internal/handler -run 'MCP|mcp' -count=1
cd ..\web
bun test test/mcp-device-approval.test.ts
~~~

---

### Task 3: Versioned CanvasProject reads/writes and browser sync integration

**Files:**

- Modify: backend/internal/repository/repository.go:1160-1185
- Create: backend/internal/service/mcp_canvas_project.go
- Create: backend/internal/service/mcp_canvas_project_test.go
- Modify: backend/internal/service/user_data.go:201-247
- Modify: backend/internal/handler/user_data.go:571-616
- Modify: web/src/services/api/user-data.ts:96-110
- Modify: web/src/services/user-data-sync.ts:1-420
- Modify: web/src/stores/canvas/use-canvas-store.ts:1-500
- Create: web/test/canvas-remote-revision.test.ts

**Interfaces:**

- Repository.UpdateCanvasProjectIfPrecondition(project, expectedRevision, expectedHash).
- Service GetMCPProject, ListMCPProjects, SaveCanvasProjectWithPrecondition.
- Browser RemoteCanvasVersion { revision: number; stateHash: string }.

- [ ] **Step 1: Add conditional repository update.**

Use WHERE id, user_id, revision and state_hash all match. Update payload/title/project/revision/hash/time and return whether exactly one row changed. New rows start at revision zero.

- [ ] **Step 2: Add service envelopes.**

Return project JSON plus revision, stateHash and hashSource=server. Enforce ownership in every read and write.

- [ ] **Step 3: Extend normal web PUT.**

Accept optional expectedRevision and expectedStateHash. When supplied, return 409 plus current metadata on mismatch; otherwise preserve existing sync behavior and return stored metadata.

- [ ] **Step 4: Track remote versions separately from IndexedDB revision.**

Add a remoteCanvasVersions map keyed by user scope and canvas ID. Hydrate it from a versioned user-data snapshot or versioned project reads, send it on saves, update acknowledgements, and clear it on logout. Extend the snapshot response only if needed to carry the same revision/stateHash metadata; do not infer server versions from the browser IndexedDB revision.

- [ ] **Step 5: Surface conflicts without stale retries.**

On 409 keep local state, stop the retry loop, and show “画布已被其他窗口或 MCP 修改，请重新加载/合并”. Test version increment, stale revision/hash rejection and user isolation.

~~~powershell
cd backend
go test ./internal/repository ./internal/service ./internal/handler -run 'Canvas.*(Revision|Precondition|Conflict)|MCPProject' -count=1
cd ..\web
bun test test/canvas-remote-revision.test.ts
~~~

---

### Task 4: Backend online Canvas MCP tools, ops validation and atomic apply

**Files:**

- Create: backend/internal/service/mcp_canvas.go
- Create: backend/internal/service/mcp_canvas_ops.go
- Create: backend/internal/service/mcp_canvas_ops_test.go
- Create: backend/internal/handler/mcp_canvas.go
- Modify: backend/cmd/server/main.go:111-145
- Create: backend/internal/model/mcp_audit.go
- Create: backend/internal/repository/mcp_audit.go

**Interfaces:**

- ExecuteMCPReadTool, ValidateMCPCanvasOps, ApplyMCPCanvasOps, SubmitMCPGeneration.
- GET /api/mcp/projects, GET /api/mcp/projects/:id, POST .../tools/validate, .../tools/apply and .../tools/generate.

- [ ] **Step 1: Decode the public canvas snapshot.**

Support identity/title/viewport/selectedNodeIds, nodes with id/type/title/position/width/height/metadata, and connections with endpoint/handle IDs. Preserve unknown metadata for round-trip; reject inline media data URLs.

- [ ] **Step 2: Implement read projections.**

Implement context, find/get node, get connection, generation-task, resource and selection projections. Recursively strip URL/publicUrl/downloadUrl/apiKey/token/cookie keys from MCP output.

- [ ] **Step 3: Implement the ops validator.**

Support add_node, update_node, delete_node, delete_connections, connect_nodes, set_viewport, select_nodes and run_generation. Validate live IDs, duplicates, self-connections, duplicate endpoint/handle pairs, finite coordinates, dimensions in (0,10000], supported node types and forbidden direct media status changes.

- [ ] **Step 4: Implement all-or-nothing application.**

Apply operations to a copy, cascade node deletion to its connections, and produce verification with created/removed IDs, missing references, overlap warnings and before/after hashes. Do not update the database until every operation validates.

- [ ] **Step 5: Enforce preconditions and transactions.**

Require both revision and hash for writes; compare them inside a transaction, apply on a copy, conditionally update, and return 409 when no row changes. Failed batches leave payload, revision and audit unchanged.

- [ ] **Step 6: Route generation and audit.**

Use the existing task service and idempotency identity for run_generation/generate. Return submitted/taskId/nodeId/status without claiming resource completion. Append redacted MCP audit rows with user, token family, canvas, tool, request ID, operation count and revision before/after.

- [ ] **Step 7: Register handlers and test.**

GET requires canvas:read; validate/apply require canvas:write; generation requires both canvas:generate and canvas:write. Map errors to 401/403/404/409/422/428/429 as specified. Test every op, rollback, redaction, generation idempotency, scope and cross-user isolation.

~~~powershell
cd backend
go test ./internal/service ./internal/handler ./internal/repository -run 'MCPCanvas|CanvasMCP|MCPAudit' -count=1
~~~

---

### Task 5: Remote stdio MCP adapter and CLI commands

**Files:**

- Modify: canvas-agent/package.json:1-40
- Modify: canvas-agent/src/index.ts:1-20
- Create: canvas-agent/src/remote-config.ts
- Create: canvas-agent/src/remote-client.ts
- Create: canvas-agent/src/cli.ts
- Modify: canvas-agent/src/mcp-server.ts:1-80
- Create: canvas-agent/src/tool-planner.ts
- Modify: canvas-agent/src/canvas-context.ts exports
- Create: canvas-agent/test/remote-client.test.ts
- Create: canvas-agent/test/cli.test.ts
- Modify: plugins/yingce/.mcp.json

**Interfaces:**

- Commands: canvas-agent login web, project list, project use <id>, project unuse and mcp.
- RemoteMcpClient.request, loadRemoteConfig, loadProjectSelection and saveProjectSelection.

- [ ] **Step 1: Replace Local Runtime config.**

Use YINGCE_SERVER_URL and YINGCE_CONFIG_DIR (default ~/.yingce). Store credentials in credentials.json and directory selection in .yingce/project.json. Remove loopback URL, trusted origins, master token and runtime-owner fields from the remote config.

- [ ] **Step 2: Implement bounded HTTP and refresh.**

Set Bearer Authorization, parse the standard envelope, honor Retry-After for 429, refresh once on 401, and map 409/428/422 to structured errors. Never automatically replay a dispatched write.

- [ ] **Step 3: Implement device-login and project-selection commands.**

login web creates the device session, prints or opens verification URI, polls at the server interval, and writes only tokens/server URL. project list prints summaries; project use verifies the project before writing .yingce/project.json; project unuse removes only that file.

- [ ] **Step 4: Extract pure tool planning.**

Move workflow/create/move/delete/connect/generate input-to-ops conversions from canvas-session.ts into tool-planner.ts. The planner cannot access HTTP, process state or browser SSE. Keep existing schemas and tool names.

- [ ] **Step 5: Rebuild MCP registration.**

Read tools GET the selected project and use pure context projections; validate/apply/generate call backend routes with canvasProjectId, expectedRevision and expectedStateHash. Remove registerDreaminaMcp.

- [ ] **Step 6: Make entrypoint non-runtime.**

index.ts dispatches only CLI subcommands and mcp. No-argument execution prints help and exits non-zero without importing Express or starting a server.

- [ ] **Step 7: Update metadata and tests.**

Keep the plugin stdio command npx -y @ddcat666/open-ai-canvas-agent mcp, optionally add a yingce bin alias, and test envelopes, refresh-once, no write replay, device polling, project files, planner output and all tool names.

~~~powershell
cd canvas-agent
npm test
npm run build
~~~

---

### Task 6: Remove Local Runtime and local-only UI/capability paths

**Files:**

- Delete: canvas-agent/src/local-runtime.ts, local-runtime-host.ts, local-runtime-session.ts, http-server.ts
- Delete: canvas-agent/src/modules/canvas-agent-http.ts, dreamina-http.ts, portrait-clearance-http.ts
- Delete or isolate local Dreamina and portrait-clearance implementation files after import inventory
- Modify: canvas-agent/package.json dependencies
- Rewrite/delete exclusive canvas-agent and web local-runtime/local-dreamina/portrait tests
- Modify: web/src/components/layout/client-root-init.tsx
- Modify: web/src/stores/use-local-dreamina-model-store.ts
- Modify: web/src/pages/tasks/index.tsx
- Modify: web/src/pages/settings/index.tsx
- Delete: web/src/pages/settings/local-cli-settings.tsx
- Delete: web/src/lib/canvas/local-agent-setup.ts
- Delete: web/src/lib/canvas/local-runtime-connection.ts
- Delete: web/src/components/canvas/canvas-local-agent-panel.tsx
- Modify: web/src/components/canvas/canvas-assistant-panel.tsx and web/src/pages/canvas/project.tsx

**Interfaces:**

- Preserve online Agent component/session/operation interfaces.
- Remove browser references to agentUrl, agentToken, runtime/info, /api/tools and 17371.

- [ ] **Step 1: Inventory imports before deletion.**

~~~powershell
rg -n "local-runtime|local-agent|dreamina-http|portrait-clearance-http|runtime/info|/api/tools|agentUrl|agentToken|17371" canvas-agent web/src plugins/yingce
~~~

Move shared pure helpers before deleting a Runtime wrapper.

- [ ] **Step 2: Delete Runtime wiring and unused dependencies.**

Verify Task 5's entrypoint, remote config and MCP server do not import Runtime modules. Remove Express/ONNX/Playwright/Sharp only when the build proves no remaining consumer; retain dependencies used by Bridge or document generation.

- [ ] **Step 3: Remove local UI paths.**

Keep online Agent history/undo and website generation. Remove local mode props, settings cards, task-center local discovery and portrait/Dreamina local auto-read paths. Keep ComfyUI Bridge unchanged.

- [ ] **Step 4: Replace exclusive tests with no-loop regressions.**

Delete tests only after adding remote MCP and no-local-runtime assertions. Keep online provider contract tests still used by the web app.

---

### Task 7: Documentation and integrated verification

**Files:**

- Modify: canvas-agent/README.md
- Modify: plugins/yingce/README.md
- Modify: plugins/yingce/skills/open-canvas/SKILL.md
- Create or modify: docs/content/docs/backend/mcp.mdx
- Modify: docs/content/docs/backend/backend-database.mdx
- Modify: docs/content/docs/progress/pending-test.mdx

- [ ] **Step 1: Document remote MCP usage.**

Document login web, project list/use/unuse, .yingce/project.json, stdio adapter boundaries, scopes, conflict errors and the fact that webpage confirmation is not required for MCP destructive operations.

- [ ] **Step 2: Document API/database contracts.**

Add routes, envelopes, status codes, CanvasProject revision/state_hash, MCP tables/indexes and migration behavior.

- [ ] **Step 3: Run complete verification.**

~~~powershell
cd backend
go test ./...
cd ..\canvas-agent
npm test
npm run build
cd ..\web
bun test
bun run build
~~~

Use authenticated browser checks for /login, /canvas/:id, /mcp/device, online Agent, normal save and an externally modified canvas conflict. Record missing credentials or unavailable PostgreSQL separately.

- [ ] **Step 4: Run final static checks and commit slices.**

~~~powershell
rg -n "local-runtime|local-agent|runtime/info|/api/tools|agentUrl|agentToken|127\\.0\\.0\\.1:17371" canvas-agent web/src plugins/yingce
git diff --check
git status --short
~~~

Stage only the completed slice, inspect git diff --staged, scan for secrets and commit with the repository format.

## Plan self-review

- Spec coverage: auth, project selection, online API, tool semantics, revision/stateHash, generation, audit, web boundary, Local Runtime removal, migration, errors and verification have explicit tasks.
- Scope: tasks are dependency-ordered; the old Runtime is not required by later tasks.
- Type consistency: CanvasMCPProject and RemoteCanvasProject use revision/stateHash/hashSource; adapter preconditions use expectedRevision/expectedStateHash.
- Placeholder audit: every step names concrete files, interfaces, commands and expected behavior.
- Safety: destructive MCP operations are host-approved and server-authorized; writes are conditional and transactional; existing user changes stay untouched.
