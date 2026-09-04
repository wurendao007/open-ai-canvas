# Task 4 report: backend online Canvas MCP tools

## Scope

Implemented the backend-facing Canvas MCP tool slice from the Task 4 brief:

- Public snapshot decoding for identity/title/viewport/selection, nodes,
  connections, unknown metadata and inline `data:` media rejection.
- Read projections for state/context/find/get node/get connection/generation
  tasks/resources/selection, with recursive removal of URL and credential keys.
- Validation and all-or-nothing in-memory application for all eight operation
  types. Node deletion cascades to related connections; verification reports
  IDs, hashes and overlap warnings.
- Revision and state-hash preconditions, ownership checks, conditional update
  and same-transaction redacted MCP audit insertion.
- Generation submission through the existing `CreateTask` service and an
  idempotency lookup based on user/canvas/node/client operation identity.
- Bearer scope-protected HTTP routes under `/api/mcp/projects*` and startup
  registration.

## Security boundaries

MCP responses recursively remove `url`, `publicUrl`, `downloadUrl`, `apiKey`,
`token`, `cookie`, access-token and refresh-token keys. Audit rows contain only
user/token-family/canvas/tool/request metadata, operation count and revision
numbers plus a type-only operation summary. No raw prompt, payload, media URL
or secret is written by this slice. Generation and apply routes require the
specified MCP scopes; all project reads and writes are user-scoped.

## Verification

Passing focused command:

```powershell
cd backend
go test ./internal/service ./internal/handler ./internal/repository -run 'MCPCanvas|CanvasMCP|MCPAudit' -count=1
```

The focused service tests cover invalid operations, finite/dimension checks,
media status protection, atomic rollback, cascading connection deletion,
metadata round-trip and inline data URL rejection.

## Known concern

`go test ./...` currently reaches the pre-existing
`backend/cmd/migrate-sqlite-postgres` coverage test and reports that its
explicit migration list does not include `mcp_device_sessions`, `mcp_tokens`
and (when registered) `mcp_audit_events`. That command is outside the Task 4
file allow-list, so it was not modified here; the migration-list update should
be handled in the migration task/owner before release.

## Files

The implementation is limited to the Task 4 service, handler, audit model and
repository files plus server route registration and this report. Existing
unrelated worktree changes were preserved.
