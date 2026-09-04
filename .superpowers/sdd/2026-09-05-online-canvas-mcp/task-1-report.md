# Task 1 报告：公共数据合同、规范化哈希和数据库模型

## 改动文件

- `backend/internal/model/models_project.go`
  - 为 `CanvasProject` 增加 `Revision int64` 和 `StateHash string`。
  - 两个字段均为非空数据库字段，默认值分别为 `0` 和空字符串，并建立索引。
  - 未改动 `PayloadJSON` 的内容或字段位置。
- `backend/internal/model/models_mcp.go`
  - 新增 `MCPDeviceSession`，保存设备授权流程所需的哈希、客户端、scope、状态、过期和审批/消费时间。
  - 新增 `MCPToken`，保存 token 哈希、token family、scope、状态、过期、轮换和撤销时间。
  - 明文设备码、用户码和 token 使用 `json:"-"`，数据库仅保存哈希。
- `backend/internal/database/schema.go`
  - 将两个 MCP 模型加入 `database.Models()`。
  - 在基线迁移的 `AutoMigrate` 后回填已有 `CanvasProject.StateHash`。
  - 回填只更新状态摘要，保持 `Revision` 为历史默认零值，不重写历史 `PayloadJSON`。
  - 迁移使用与服务合同一致的 JSON 规范化、临时字段清单、内嵌媒体拒绝和 SHA-256 base64url 编码。
- `backend/internal/service/mcp_contract.go`
  - 新增 `CanvasMCPProject`、`CanvasMCPProjectSummary`、`CanvasMCPPrecondition`。
  - 新增 `NormalizeCanvasPayload` 和 `CanvasStateHash`。
  - 规范化只移除根对象中的显式临时字段 `clientId`、`revision`、`stateHash`、`state_hash`；数组、非对象、非法 JSON 和 `data:` 内嵌媒体均拒绝。
  - 摘要为完整 SHA-256，使用无填充 base64url。
- `backend/internal/service/mcp_contract_test.go`
  - 覆盖键序稳定性、临时字段忽略、节点变化敏感性、非法 JSON/数组、内嵌媒体拒绝、合同 payload 往返和迁移默认值。
- `canvas-agent/src/remote-contract.ts`
  - 新增 `RemoteCanvasEnvelope`、`RemoteCanvasProject`、`RemoteCanvasPrecondition`。
- `canvas-agent/test/remote-contract.test.ts`
  - 验证远程合同的版本字段和 payload 类型可用。

## 合同和迁移细节

- `stateHash` 是完整 SHA-256 摘要，格式为无填充 base64url，长度为 43 个字符。
- JSON 对象经 `encoding/json` 编码后键序稳定；原始画布 payload 不会因计算摘要而被持久化重排。
- MCP 哈希字段使用唯一索引；用户、token family、状态和过期时间具备单列或组合索引，满足设备授权和 token 轮换查询。
- 设备会话和 token 的秘密字段不出现在 JSON 序列化结果中。

## 测试命令及真实输出

通过：

```text
cd backend
go test ./internal/service -run 'TestCanvasStateHash|TestNormalizeCanvasPayload|TestMCPModel' -count=1
ok  	infinite-canvas/backend/internal/service	0.082s

go test ./internal/database ./internal/model -count=1
ok  	infinite-canvas/backend/internal/database	0.159s
?   	infinite-canvas/backend/internal/model	[no test files]

cd ..\canvas-agent
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node --import tsx/esm --test test/remote-contract.test.ts
✔ remote contract
ℹ tests 1
ℹ pass 1
```

按 brief 原样执行的 `npm test -- --test-name-pattern='remote contract'` 未能启动，原因是工作树已有 `package.json` 的 `overrides` 与直接依赖产生 npm `EOVERRIDE`。使用现有 `node_modules` 运行等价的单文件测试和 TypeScript 检查均通过。该 npm 配置冲突未由本任务引入或修改。

## 未解决风险

- brief 没有列出完整的 MCP 状态枚举或 scope 取值；本任务按字符串和 JSON 文本保存，具体状态机由 Task 2 约束。
- brief 没有给出远程 envelope 的错误字段；当前 `RemoteCanvasEnvelope` 对齐仓库统一 `{code,data,msg}` 响应合同。
- 迁移遇到历史非法 JSON 或 `data:` 内嵌媒体会失败并回滚，而不是猜测摘要；这是 fail-closed 行为，需要后续部署前清理异常历史数据。
- `CanvasProject` 的现有浏览器写路径尚未自动填充 revision/stateHash；按任务拆分由 Task 3 接入版本化读写。
