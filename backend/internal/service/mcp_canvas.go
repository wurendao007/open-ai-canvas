package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

var mcpGenerationMu sync.Mutex

type MCPToolRequest struct {
	Ops               []MCPCanvasOp `json:"ops,omitempty"`
	ExpectedRevision  *int64        `json:"expectedRevision,omitempty"`
	ExpectedStateHash string        `json:"expectedStateHash,omitempty"`
	RequestID         string        `json:"-"`
	TokenFamilyID     string        `json:"-"`
}
type MCPGenerationRequest struct {
	NodeID            string         `json:"nodeId"`
	Mode              string         `json:"mode"`
	Prompt            string         `json:"prompt"`
	Config            map[string]any `json:"config,omitempty"`
	ClientOperationID string         `json:"clientOperationId,omitempty"`
	IdempotencyKey    string         `json:"idempotencyKey,omitempty"`
	Retry             bool           `json:"retry,omitempty"`
	ExpectedRevision  *int64         `json:"expectedRevision,omitempty"`
	ExpectedStateHash string         `json:"expectedStateHash,omitempty"`
	RequestID         string         `json:"-"`
	TokenFamilyID     string         `json:"-"`
}
type MCPGenerationResult struct {
	Submitted bool   `json:"submitted"`
	TaskID    string `json:"taskId"`
	NodeID    string `json:"nodeId"`
	Status    string `json:"status"`
}

func (s *Service) ExecuteMCPReadTool(userID, canvasID, tool string, input map[string]any) (any, error) {
	project, err := s.repo.CanvasProjectForUser(userID, strings.TrimSpace(canvasID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(http.StatusNotFound, "画布不存在")
	}
	if err != nil {
		return nil, err
	}
	snapshot, err := DecodeMCPCanvasSnapshot(json.RawMessage(project.PayloadJSON))
	if err != nil {
		return nil, NewAppError(http.StatusUnprocessableEntity, "画布快照无效")
	}
	result, err := executeMCPReadProjection(snapshot, tool, input)
	if err != nil {
		return nil, NewAppError(http.StatusUnprocessableEntity, err.Error())
	}
	return map[string]any{"data": sanitizeMCPOutput(result), "revision": project.Revision, "stateHash": project.StateHash, "hashSource": "server"}, nil
}

func executeMCPReadProjection(snapshot MCPCanvasSnapshot, tool string, input map[string]any) (any, error) {
	if input == nil {
		input = map[string]any{}
	}
	nodeByID := map[string]MCPCanvasNode{}
	for _, n := range snapshot.Nodes {
		nodeByID[n.ID] = n
	}
	switch tool {
	case "canvas_get_state", "canvas_export_snapshot":
		return snapshot, nil
	case "canvas_get_context":
		return map[string]any{"schemaVersion": 1, "canvas": map[string]any{"projectId": snapshot.ID, "domainProjectId": snapshot.DomainProjectID, "title": snapshot.Title, "viewport": snapshot.Viewport, "nodeCount": len(snapshot.Nodes), "connectionCount": len(snapshot.Connections), "selectedNodeCount": len(snapshot.SelectedNodeIDs)}, "selection": projectMCPSelection(snapshot, nodeByID), "nodes": projectMCPNodes(snapshot.Nodes), "connections": projectMCPConnections(snapshot.Connections, nodeByID), "resources": projectMCPResources(snapshot.Nodes), "warnings": []string{}}, nil
	case "canvas_find_nodes":
		query := strings.ToLower(strings.TrimSpace(stringValueAny(input["query"])))
		limit := int(numberAny(input["limit"], 50))
		if limit < 1 {
			limit = 1
		}
		if limit > 200 {
			limit = 200
		}
		ids := toStringSet(input["ids"])
		types := toStringSet(input["types"])
		statuses := toStringSet(input["statuses"])
		nodes := []any{}
		for _, n := range snapshot.Nodes {
			if len(ids) > 0 && !ids[n.ID] {
				continue
			}
			if len(types) > 0 && !types[n.Type] {
				continue
			}
			status := stringValueAny(n.Metadata["status"])
			if status == "" {
				status = "idle"
			}
			if len(statuses) > 0 && !statuses[status] {
				continue
			}
			if query != "" && !strings.Contains(strings.ToLower(n.ID+" "+n.Title+" "+stringValueAny(n.Metadata["content"])+" "+stringValueAny(n.Metadata["prompt"])), query) {
				continue
			}
			nodes = append(nodes, projectMCPNode(n))
		}
		total := len(nodes)
		truncated := total > limit
		if truncated {
			nodes = nodes[:limit]
		}
		return map[string]any{"query": stringValueAny(input["query"]), "total": total, "truncated": truncated, "nodes": nodes}, nil
	case "canvas_get_node":
		id := stringValueAny(input["id"])
		n, ok := nodeByID[id]
		if !ok {
			return map[string]any{"found": false, "id": id, "node": nil, "connections": []any{}}, nil
		}
		return map[string]any{"found": true, "id": id, "node": projectMCPNode(n), "connections": projectMCPConnectionsForNode(snapshot.Connections, n, nodeByID)}, nil
	case "canvas_get_connection":
		id := stringValueAny(input["id"])
		for _, c := range snapshot.Connections {
			if c.ID == id {
				return map[string]any{"found": true, "id": id, "connection": c, "fromNode": projectMCPNode(nodeByID[c.FromNodeID]), "toNode": projectMCPNode(nodeByID[c.ToNodeID])}, nil
			}
		}
		return map[string]any{"found": false, "id": id, "connection": nil}, nil
	case "canvas_get_selection":
		return map[string]any{"ids": snapshot.SelectedNodeIDs, "nodes": projectMCPSelection(snapshot, nodeByID)}, nil
	case "canvas_get_resources":
		return map[string]any{"resources": projectMCPResources(snapshot.Nodes)}, nil
	case "canvas_get_generation_tasks":
		tasks := []any{}
		for _, n := range snapshot.Nodes {
			if id := stringValueAny(n.Metadata["taskId"]); id != "" {
				tasks = append(tasks, map[string]any{"taskId": id, "nodeId": n.ID, "nodeTitle": n.Title, "mode": n.Metadata["generationMode"], "nodeStatus": n.Metadata["status"], "status": n.Metadata["taskStatus"], "progress": n.Metadata["taskProgress"], "stage": n.Metadata["taskStage"], "provider": n.Metadata["taskProvider"], "resourceReady": n.Metadata["status"] == "success"})
			}
		}
		return map[string]any{"tasks": tasks, "total": len(tasks)}, nil
	default:
		return nil, fmt.Errorf("不支持的 MCP 读工具")
	}
}

func (s *Service) ValidateMCPCanvasOps(userID, canvasID string, req MCPToolRequest) (*MCPOpsValidation, error) {
	project, err := s.repo.CanvasProjectForUser(userID, strings.TrimSpace(canvasID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(404, "画布不存在")
	}
	if err != nil {
		return nil, err
	}
	snapshot, err := DecodeMCPCanvasSnapshot(json.RawMessage(project.PayloadJSON))
	if err != nil {
		return nil, NewAppError(422, "画布快照无效")
	}
	result := ValidateMCPCanvasOps(snapshot, req.Ops)
	result.CurrentStateHash = project.StateHash
	return &result, nil
}

func (s *Service) ApplyMCPCanvasOps(userID, canvasID string, req MCPToolRequest) (map[string]any, error) {
	if req.ExpectedRevision == nil || strings.TrimSpace(req.ExpectedStateHash) == "" {
		return nil, NewAppError(428, "缺少画布版本前置条件")
	}
	project, err := s.repo.CanvasProjectForUser(userID, strings.TrimSpace(canvasID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(404, "画布不存在")
	}
	if err != nil {
		return nil, err
	}
	if project.Revision != *req.ExpectedRevision || project.StateHash != req.ExpectedStateHash {
		return nil, NewAppError(409, "画布已被其他窗口或 MCP 修改，请重新加载/合并")
	}
	snapshot, err := DecodeMCPCanvasSnapshot(json.RawMessage(project.PayloadJSON))
	if err != nil {
		return nil, NewAppError(422, "画布快照无效")
	}
	after, verification, err := ApplyMCPCanvasOps(snapshot, req.Ops)
	if err != nil {
		return nil, NewAppError(422, err.Error())
	}
	payload, _ := json.Marshal(after)
	hash, err := model.CanvasStateHash(payload)
	if err != nil {
		return nil, NewAppError(422, "画布快照无效")
	}
	updated := *project
	updated.PayloadJSON = string(payload)
	updated.Title = after.Title
	updated.ProjectID = after.ProjectID
	if updated.ProjectID == "" {
		updated.ProjectID = after.DomainProjectID
	}
	updated.Revision = project.Revision + 1
	updated.StateHash = hash
	updated.UpdatedAt = time.Now()
	audit := &model.MCPAuditEvent{ID: newID(), UserID: userID, TokenFamilyID: req.TokenFamilyID, CanvasID: canvasID, Tool: "canvas_apply_ops", RequestID: req.RequestID, OperationCount: len(req.Ops), RevisionBefore: project.Revision, RevisionAfter: updated.Revision, SummaryJSON: mcpOpsSummary(req.Ops), CreatedAt: time.Now()}
	stored, ok, err := s.repo.ApplyCanvasMCPAtomic(userID, canvasID, *req.ExpectedRevision, req.ExpectedStateHash, &updated, audit)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, NewAppError(409, "画布已被其他窗口或 MCP 修改，请重新加载/合并")
	}
	var generationResult *MCPGenerationResult
	for _, op := range req.Ops {
		if op.Type != "run_generation" {
			continue
		}
		generationResult, err = s.SubmitMCPGeneration(userID, canvasID, MCPGenerationRequest{NodeID: op.NodeID, Mode: op.Mode, Prompt: op.Prompt, Retry: op.Retry, ClientOperationID: op.ID, ExpectedRevision: &stored.Revision, ExpectedStateHash: stored.StateHash, RequestID: req.RequestID, TokenFamilyID: req.TokenFamilyID})
		if err != nil {
			if _, rollbackErr := s.repo.RollbackCanvasMCPAtomic(userID, canvasID, stored.Revision, stored.StateHash, project, audit.ID); rollbackErr != nil {
				return nil, fmt.Errorf("生成失败：%v；画布回滚失败：%w", err, rollbackErr)
			}
			return nil, err
		}
		break
	}
	result := map[string]any{"project": sanitizeMCPOutput(after), "verification": verification, "revision": stored.Revision, "stateHash": stored.StateHash, "hashSource": "server"}
	if generationResult != nil {
		result["generation"] = generationResult
	}
	return result, nil
}

func (s *Service) SubmitMCPGeneration(userID, canvasID string, req MCPGenerationRequest) (*MCPGenerationResult, error) {
	if req.ExpectedRevision == nil || strings.TrimSpace(req.ExpectedStateHash) == "" {
		return nil, NewAppError(http.StatusPreconditionRequired, "缺少画布版本前置条件")
	}
	project, err := s.repo.CanvasProjectForUser(userID, strings.TrimSpace(canvasID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(http.StatusNotFound, "画布不存在")
	}
	if err != nil {
		return nil, err
	}
	if project.Revision != *req.ExpectedRevision || project.StateHash != req.ExpectedStateHash {
		return nil, NewAppError(http.StatusConflict, "画布已被其他窗口或 MCP 修改，请重新加载/合并")
	}
	snapshot, err := DecodeMCPCanvasSnapshot(json.RawMessage(project.PayloadJSON))
	if err != nil {
		return nil, NewAppError(http.StatusUnprocessableEntity, "画布快照无效")
	}
	var target MCPCanvasNode
	found := false
	for _, node := range snapshot.Nodes {
		if node.ID == strings.TrimSpace(req.NodeID) {
			target = node
			found = true
			break
		}
	}
	if !found {
		return nil, NewAppError(http.StatusUnprocessableEntity, "生成节点不存在")
	}
	mode := strings.TrimSpace(req.Mode)
	if mode == "" {
		mode = "image"
	}
	if mode != "text" && mode != "image" && mode != "video" && mode != "audio" {
		return nil, NewAppError(422, "不支持的生成模式")
	}
	if (mode == "image" || mode == "video" || mode == "audio") && !mcpIsMediaType(target.Type) {
		return nil, NewAppError(422, "生成模式与节点类型不匹配")
	}
	if mode == "text" && target.Type != "text" && target.Type != "script" {
		return nil, NewAppError(422, "生成模式与节点类型不匹配")
	}
	identity := strings.TrimSpace(req.IdempotencyKey)
	if identity == "" {
		identity = strings.TrimSpace(req.ClientOperationID)
	}
	if identity != "" {
		mcpGenerationMu.Lock()
		defer mcpGenerationMu.Unlock()
		if existing, e := s.repo.MCPTaskByIdempotency(userID, canvasID, req.NodeID, identity); e == nil && existing != nil {
			return &MCPGenerationResult{Submitted: true, TaskID: existing.ID, NodeID: req.NodeID, Status: string(existing.Status)}, nil
		}
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return nil, NewAppError(422, "生成提示词不能为空")
	}
	input := map[string]any{"mode": mode, "prompt": req.Prompt, "metadata": map[string]any{"nodeId": req.NodeID, "clientOperationId": identity}}
	if req.Config != nil {
		input["config"] = req.Config
	}
	task, err := s.CreateTask(userID, CreateTaskRequest{ProjectID: canvasID, Type: "canvas_" + mode, Operation: mode, Prompt: req.Prompt, Input: input, RequestID: identity})
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateMCPAuditEvent(&model.MCPAuditEvent{ID: newID(), UserID: userID, TokenFamilyID: req.TokenFamilyID, CanvasID: canvasID, Tool: "canvas_generate", RequestID: req.RequestID, OperationCount: 1, RevisionBefore: project.Revision, RevisionAfter: project.Revision, SummaryJSON: mcpOpsSummary([]MCPCanvasOp{{Type: "run_generation", NodeID: req.NodeID}}), CreatedAt: time.Now()}); err != nil {
		cleanupErr := s.repo.DeleteMCPTask(userID, task.ID)
		if task.BillingOrderID != "" {
			if refundErr := s.taskBilling().RefundBilling(task.BillingOrderID, "MCP 生成审计写入失败"); cleanupErr == nil {
				cleanupErr = refundErr
			}
		}
		if cleanupErr != nil {
			return nil, fmt.Errorf("生成审计写入失败：%v；任务清理失败：%w", err, cleanupErr)
		}
		return nil, err
	}
	return &MCPGenerationResult{Submitted: true, TaskID: task.ID, NodeID: req.NodeID, Status: string(task.Status)}, nil
}

func projectMCPNode(n MCPCanvasNode) map[string]any {
	return map[string]any{"id": n.ID, "type": n.Type, "title": n.Title, "position": n.Position, "width": n.Width, "height": n.Height, "parentId": n.ParentID, "metadata": sanitizeMCPOutput(n.Metadata)}
}
func projectMCPNodes(ns []MCPCanvasNode) []any {
	out := make([]any, 0, len(ns))
	for _, n := range ns {
		out = append(out, projectMCPNode(n))
	}
	return out
}
func projectMCPSelection(s MCPCanvasSnapshot, m map[string]MCPCanvasNode) []any {
	out := []any{}
	for _, id := range s.SelectedNodeIDs {
		if n, ok := m[id]; ok {
			out = append(out, projectMCPNode(n))
		}
	}
	return out
}
func projectMCPConnections(cs []MCPCanvasConnection, m map[string]MCPCanvasNode) []any {
	out := make([]any, 0, len(cs))
	for _, c := range cs {
		item := map[string]any{"id": c.ID, "fromNodeId": c.FromNodeID, "fromTitle": m[c.FromNodeID].Title, "toNodeId": c.ToNodeID, "toTitle": m[c.ToNodeID].Title, "fromHandleId": c.FromHandleID, "toHandleId": c.ToHandleID}
		out = append(out, item)
	}
	return out
}
func projectMCPConnectionsForNode(cs []MCPCanvasConnection, n MCPCanvasNode, m map[string]MCPCanvasNode) []any {
	out := []any{}
	for _, c := range cs {
		if c.FromNodeID == n.ID || c.ToNodeID == n.ID {
			out = append(out, projectMCPConnections([]MCPCanvasConnection{c}, m)[0])
		}
	}
	return out
}
func projectMCPResources(ns []MCPCanvasNode) []any {
	out := []any{}
	for _, n := range ns {
		if !mcpIsMediaType(n.Type) {
			continue
		}
		status := stringValueAny(n.Metadata["status"])
		storage := stringValueAny(n.Metadata["storageKey"])
		rid := stringValueAny(n.Metadata["resourceId"])
		out = append(out, map[string]any{"nodeId": n.ID, "nodeTitle": n.Title, "nodeType": n.Type, "status": status, "resourceId": rid, "storageKey": storage, "mimeType": n.Metadata["mimeType"], "bytes": n.Metadata["bytes"], "width": n.Metadata["naturalWidth"], "height": n.Metadata["naturalHeight"], "durationMs": n.Metadata["durationMs"], "ready": status == "success" && (storage != "" || rid != "")})
	}
	return out
}
func SanitizeMCPOutput(v any) any { return sanitizeMCPOutput(v) }

func sanitizeMCPOutput(v any) any {
	if snapshot, ok := v.(MCPCanvasSnapshot); ok {
		raw, err := marshalMCPSnapshot(snapshot)
		if err == nil {
			var decoded any
			if json.Unmarshal(raw, &decoded) == nil {
				return sanitizeMCPOutput(decoded)
			}
		}
	}
	if node, ok := v.(MCPCanvasNode); ok {
		raw, err := json.Marshal(node)
		if err == nil {
			var decoded any
			if json.Unmarshal(raw, &decoded) == nil {
				return sanitizeMCPOutput(decoded)
			}
		}
	}
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, val := range x {
			if isMCPSecretKey(k) {
				continue
			}
			out[k] = sanitizeMCPOutput(val)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, val := range x {
			out[i] = sanitizeMCPOutput(val)
		}
		return out
	default:
		rv := reflect.ValueOf(v)
		if !rv.IsValid() {
			return nil
		}
		if rv.Kind() == reflect.Pointer || rv.Kind() == reflect.Interface {
			if rv.IsNil() {
				return nil
			}
			return sanitizeMCPOutput(rv.Elem().Interface())
		}
		if rv.Kind() == reflect.Struct || rv.Kind() == reflect.Map || rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
			raw, err := json.Marshal(v)
			if err == nil {
				var decoded any
				if json.Unmarshal(raw, &decoded) == nil {
					return sanitizeMCPOutput(decoded)
				}
			}
		}
		return v
	}
}

func isMCPSecretKey(key string) bool {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(strings.TrimSpace(key)))
	switch normalized {
	case "url", "publicurl", "downloadurl", "apikey", "token", "cookie", "accesstoken", "refreshtoken", "authorization", "secret", "password":
		return true
	default:
		return false
	}
}
func mcpOpsSummary(ops []MCPCanvasOp) string {
	types := make([]string, 0, len(ops))
	for _, op := range ops {
		types = append(types, op.Type)
	}
	raw, _ := json.Marshal(map[string]any{"types": types})
	return string(raw)
}
func stringValueAny(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func numberAny(v any, def int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	}
	return def
}
func toStringSet(v any) map[string]bool {
	out := map[string]bool{}
	if arr, ok := v.([]any); ok {
		for _, x := range arr {
			if s, ok := x.(string); ok {
				out[s] = true
			}
		}
	}
	if arr, ok := v.([]string); ok {
		for _, s := range arr {
			out[s] = true
		}
	}
	return out
}
