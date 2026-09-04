package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"infinite-canvas/backend/internal/model"
)

type MCPPosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type MCPViewport struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	K float64 `json:"k"`
}
type MCPCanvasNode struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Title    string         `json:"title,omitempty"`
	Position MCPPosition    `json:"position"`
	Width    float64        `json:"width"`
	Height   float64        `json:"height"`
	ParentID string         `json:"parentId,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}
type MCPCanvasConnection struct {
	ID           string `json:"id"`
	FromNodeID   string `json:"fromNodeId"`
	ToNodeID     string `json:"toNodeId"`
	FromHandleID string `json:"fromHandleId,omitempty"`
	ToHandleID   string `json:"toHandleId,omitempty"`
}
type MCPCanvasSnapshot struct {
	ID              string                `json:"id,omitempty"`
	ProjectID       string                `json:"projectId,omitempty"`
	DomainProjectID string                `json:"domainProjectId,omitempty"`
	Title           string                `json:"title,omitempty"`
	Identity        map[string]any        `json:"identity,omitempty"`
	Viewport        MCPViewport           `json:"viewport"`
	SelectedNodeIDs []string              `json:"selectedNodeIds,omitempty"`
	Nodes           []MCPCanvasNode       `json:"nodes"`
	Connections     []MCPCanvasConnection `json:"connections"`
}

type MCPCanvasOp struct {
	Type         string         `json:"type"`
	ID           string         `json:"id,omitempty"`
	IDs          []string       `json:"ids,omitempty"`
	NodeType     string         `json:"nodeType,omitempty"`
	Title        string         `json:"title,omitempty"`
	Position     *MCPPosition   `json:"position,omitempty"`
	X            *float64       `json:"x,omitempty"`
	Y            *float64       `json:"y,omitempty"`
	Width        float64        `json:"width,omitempty"`
	Height       float64        `json:"height,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	Patch        map[string]any `json:"patch,omitempty"`
	FromNodeID   string         `json:"fromNodeId,omitempty"`
	ToNodeID     string         `json:"toNodeId,omitempty"`
	FromHandleID string         `json:"fromHandleId,omitempty"`
	ToHandleID   string         `json:"toHandleId,omitempty"`
	Viewport     *MCPViewport   `json:"viewport,omitempty"`
	NodeID       string         `json:"nodeId,omitempty"`
	Mode         string         `json:"mode,omitempty"`
	Prompt       string         `json:"prompt,omitempty"`
	Retry        bool           `json:"retry,omitempty"`
	All          bool           `json:"all,omitempty"`
}

type MCPOpIssue struct {
	Index    int    `json:"index"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}
type MCPOpsValidation struct {
	OK               bool         `json:"ok"`
	Issues           []MCPOpIssue `json:"issues"`
	OperationCount   int          `json:"operationCount"`
	CurrentStateHash string       `json:"currentStateHash"`
}
type MCPCanvasVerification struct {
	CreatedNodeIDs       []string `json:"createdNodeIds,omitempty"`
	RemovedNodeIDs       []string `json:"removedNodeIds,omitempty"`
	CreatedConnectionIDs []string `json:"createdConnectionIds,omitempty"`
	RemovedConnectionIDs []string `json:"removedConnectionIds,omitempty"`
	MissingNodeIDs       []string `json:"missingNodeIds,omitempty"`
	MissingConnectionIDs []string `json:"missingConnectionIds,omitempty"`
	OverlapWarnings      []string `json:"overlapWarnings,omitempty"`
	BeforeHash           string   `json:"beforeHash"`
	AfterHash            string   `json:"afterHash"`
}

var mcpSupportedNodeTypes = map[string]bool{"image": true, "text": true, "script": true, "config": true, "video": true, "audio": true, "frame": true, "drawing": true, "skill": true, "markdown": true, "svg": true, "html": true, "panorama": true, "compare": true, "chart": true, "colorgrade": true}

func DecodeMCPCanvasSnapshot(raw json.RawMessage) (MCPCanvasSnapshot, error) {
	var snapshot MCPCanvasSnapshot
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return snapshot, fmt.Errorf("画布数据不是有效 JSON：%w", err)
	}
	if object == nil {
		return snapshot, errors.New("画布数据必须是 JSON 对象")
	}
	if containsInlineMCPMedia(object) {
		return snapshot, errors.New("画布数据包含内嵌媒体")
	}
	bytes, _ := json.Marshal(object)
	if err := json.Unmarshal(bytes, &snapshot); err != nil {
		return snapshot, fmt.Errorf("画布快照结构无效：%w", err)
	}
	if snapshot.ID == "" {
		if identity, ok := object["identity"].(map[string]any); ok {
			snapshot.ID, _ = identity["id"].(string)
		}
	}
	if snapshot.ID == "" {
		snapshot.ID, _ = object["canvasProjectId"].(string)
	}
	if snapshot.Nodes == nil {
		snapshot.Nodes = []MCPCanvasNode{}
	}
	if snapshot.Connections == nil {
		snapshot.Connections = []MCPCanvasConnection{}
	}
	for i := range snapshot.Nodes {
		if snapshot.Nodes[i].ID == "" || snapshot.Nodes[i].Type == "" {
			return snapshot, fmt.Errorf("节点 %d 缺少 id/type", i)
		}
		if snapshot.Nodes[i].Width == 0 {
			snapshot.Nodes[i].Width = 320
		}
		if snapshot.Nodes[i].Height == 0 {
			snapshot.Nodes[i].Height = 240
		}
		if snapshot.Nodes[i].Metadata == nil {
			snapshot.Nodes[i].Metadata = map[string]any{}
		}
	}
	return snapshot, nil
}

func ValidateMCPCanvasOps(snapshot MCPCanvasSnapshot, ops []MCPCanvasOp) MCPOpsValidation {
	issues := make([]MCPOpIssue, 0)
	nodes := map[string]MCPCanvasNode{}
	for _, node := range snapshot.Nodes {
		nodes[node.ID] = node
	}
	connections := map[string]MCPCanvasConnection{}
	keys := map[string]bool{}
	for _, c := range snapshot.Connections {
		connections[c.ID] = c
		keys[mcpConnectionKey(c)] = true
	}
	issue := func(index int, msg string) {
		issues = append(issues, MCPOpIssue{Index: index, Severity: "error", Message: msg})
	}
	requireNode := func(index int, id, label string) {
		if strings.TrimSpace(id) == "" {
			issue(index, label+" 缺少节点 id")
		} else if _, ok := nodes[id]; !ok {
			issue(index, fmt.Sprintf("%s「%s」不存在", label, id))
		}
	}
	for i, op := range ops {
		switch op.Type {
		case "add_node":
			id := op.ID
			if id == "" {
				id = fmt.Sprintf("__mcp_new_%d", i)
			}
			if _, ok := nodes[id]; ok {
				issue(i, "新增节点 id 重复")
			}
			if !mcpSupportedNodeTypes[op.NodeType] {
				issue(i, "不支持的节点类型")
			}
			validateMCPNodeNumbers(issue, i, op.Position, op.X, op.Y, pointerIfNonZero(op.Width), pointerIfNonZero(op.Height))
			nodes[id] = MCPCanvasNode{ID: id, Type: op.NodeType, Position: mcpOpPosition(op), Width: mcpDimension(op.Width, 320), Height: mcpDimension(op.Height, 240), Metadata: op.Metadata}
		case "update_node":
			requireNode(i, op.ID, "更新目标")
			if _, ok := op.Patch["id"]; ok {
				issue(i, "不能修改节点 id")
			}
			if _, ok := op.Patch["type"]; ok {
				issue(i, "不能修改节点类型")
			}
			validateMCPNodeNumbers(issue, i, op.Position, nil, nil, numberFromPatch(op.Patch, "width"), numberFromPatch(op.Patch, "height"))
			node := nodes[op.ID]
			if mcpIsMediaType(node.Type) && (hasMCPStatus(op.Metadata) || hasMCPStatusMap(op.Patch)) {
				issue(i, "不能直接修改媒体节点 status")
			}
		case "delete_node":
			ids := op.IDs
			if len(ids) == 0 && op.ID != "" {
				ids = []string{op.ID}
			}
			if len(ids) == 0 && op.NodeType != "" {
				for id, n := range nodes {
					if n.Type == op.NodeType {
						ids = append(ids, id)
					}
				}
			}
			if len(ids) == 0 {
				issue(i, "删除节点必须提供 id、ids 或 nodeType")
			}
			seen := map[string]bool{}
			for _, id := range ids {
				if seen[id] {
					issue(i, "删除节点 id 不能重复")
				}
				seen[id] = true
				requireNode(i, id, "删除目标")
				delete(nodes, id)
			}
			for cid, c := range connections {
				if !mcpContainsString(ids, c.FromNodeID) && !mcpContainsString(ids, c.ToNodeID) {
					continue
				}
				delete(connections, cid)
				delete(keys, mcpConnectionKey(c))
			}
		case "delete_connections":
			if op.All && (op.ID != "" || len(op.IDs) > 0) {
				issue(i, "delete_connections 不能同时使用 all 和 id/ids")
			}
			ids := op.IDs
			if len(ids) == 0 && op.ID != "" {
				ids = []string{op.ID}
			}
			if !op.All && len(ids) == 0 {
				issue(i, "删除连线必须提供 id、ids 或 all=true")
			}
			seen := map[string]bool{}
			for _, id := range ids {
				if seen[id] {
					issue(i, "删除连线 id 不能重复")
				}
				seen[id] = true
				c, ok := connections[id]
				if !ok {
					issue(i, fmt.Sprintf("连线「%s」不存在", id))
				} else {
					delete(connections, id)
					delete(keys, mcpConnectionKey(c))
				}
			}
			if op.All {
				connections = map[string]MCPCanvasConnection{}
				keys = map[string]bool{}
			}
		case "connect_nodes":
			requireNode(i, op.FromNodeID, "连接起点")
			requireNode(i, op.ToNodeID, "连接终点")
			if op.FromNodeID == op.ToNodeID {
				issue(i, "不能连接节点自身")
			}
			id := op.ID
			if id == "" {
				id = fmt.Sprintf("__mcp_conn_%d", i)
			}
			if _, ok := connections[id]; ok {
				issue(i, "连线 id 重复")
			}
			c := MCPCanvasConnection{ID: id, FromNodeID: op.FromNodeID, ToNodeID: op.ToNodeID, FromHandleID: op.FromHandleID, ToHandleID: op.ToHandleID}
			if keys[mcpConnectionKey(c)] {
				issue(i, "相同端点和 handle 的连线已存在")
			}
			keys[mcpConnectionKey(c)] = true
			connections[id] = c
		case "set_viewport":
			if op.Viewport == nil || !finite(op.Viewport.X) || !finite(op.Viewport.Y) || !finite(op.Viewport.K) || op.Viewport.K < 0.05 || op.Viewport.K > 8 {
				issue(i, "视口参数无效")
			}
		case "select_nodes":
			seen := map[string]bool{}
			for _, id := range op.IDs {
				if seen[id] {
					issue(i, "选区节点 id 不能重复")
				}
				seen[id] = true
				requireNode(i, id, "选区节点")
			}
		case "run_generation":
			requireNode(i, op.NodeID, "生成目标")
			node := nodes[op.NodeID]
			if op.Mode != "" && op.Mode != node.Type && !(op.Mode == "text" && node.Type == "script") {
				issue(i, "生成模式与节点类型不匹配")
			}
		default:
			issue(i, "不支持的操作类型")
		}
	}
	beforeHash, _ := hashMCPSnapshot(snapshot)
	return MCPOpsValidation{OK: len(issues) == 0, Issues: issues, OperationCount: len(ops), CurrentStateHash: beforeHash}
}

func ApplyMCPCanvasOps(snapshot MCPCanvasSnapshot, ops []MCPCanvasOp) (MCPCanvasSnapshot, MCPCanvasVerification, error) {
	validation := ValidateMCPCanvasOps(snapshot, ops)
	if !validation.OK {
		return snapshot, MCPCanvasVerification{BeforeHash: validation.CurrentStateHash}, fmt.Errorf("画布操作校验失败")
	}
	copyOf, _ := cloneMCPSnapshot(snapshot)
	verification := MCPCanvasVerification{BeforeHash: validation.CurrentStateHash}
	nodeIDs := map[string]bool{}
	for _, n := range copyOf.Nodes {
		nodeIDs[n.ID] = true
	}
	connIDs := map[string]bool{}
	for _, c := range copyOf.Connections {
		connIDs[c.ID] = true
	}
	for i, op := range ops {
		switch op.Type {
		case "add_node":
			id := op.ID
			if id == "" {
				id = fmt.Sprintf("mcp-node-%d", i)
			}
			node := MCPCanvasNode{ID: id, Type: op.NodeType, Title: op.Title, Position: mcpOpPosition(op), Width: mcpDimension(op.Width, 320), Height: mcpDimension(op.Height, 240), Metadata: cloneMap(op.Metadata)}
			copyOf.Nodes = append(copyOf.Nodes, node)
			verification.CreatedNodeIDs = append(verification.CreatedNodeIDs, id)
			nodeIDs[id] = true
		case "update_node":
			for j := range copyOf.Nodes {
				if copyOf.Nodes[j].ID != op.ID {
					continue
				}
				applyMCPNodePatch(&copyOf.Nodes[j], op)
				break
			}
		case "delete_node":
			ids := op.IDs
			if len(ids) == 0 && op.ID != "" {
				ids = []string{op.ID}
			}
			if len(ids) == 0 && op.NodeType != "" {
				for _, n := range copyOf.Nodes {
					if n.Type == op.NodeType {
						ids = append(ids, n.ID)
					}
				}
			}
			remove := map[string]bool{}
			for _, id := range ids {
				remove[id] = true
				verification.RemovedNodeIDs = append(verification.RemovedNodeIDs, id)
			}
			nodes := copyOf.Nodes[:0]
			for _, n := range copyOf.Nodes {
				if !remove[n.ID] {
					nodes = append(nodes, n)
				}
			}
			copyOf.Nodes = nodes
			conns := copyOf.Connections[:0]
			for _, c := range copyOf.Connections {
				if remove[c.FromNodeID] || remove[c.ToNodeID] {
					verification.RemovedConnectionIDs = append(verification.RemovedConnectionIDs, c.ID)
				} else {
					conns = append(conns, c)
				}
			}
			copyOf.Connections = conns
		case "delete_connections":
			ids := map[string]bool{}
			for _, id := range op.IDs {
				ids[id] = true
			}
			if op.ID != "" {
				ids[op.ID] = true
			}
			conns := copyOf.Connections[:0]
			for _, c := range copyOf.Connections {
				if op.All || ids[c.ID] {
					verification.RemovedConnectionIDs = append(verification.RemovedConnectionIDs, c.ID)
				} else {
					conns = append(conns, c)
				}
			}
			copyOf.Connections = conns
		case "connect_nodes":
			id := op.ID
			if id == "" {
				id = fmt.Sprintf("mcp-connection-%d", i)
			}
			copyOf.Connections = append(copyOf.Connections, MCPCanvasConnection{ID: id, FromNodeID: op.FromNodeID, ToNodeID: op.ToNodeID, FromHandleID: op.FromHandleID, ToHandleID: op.ToHandleID})
			verification.CreatedConnectionIDs = append(verification.CreatedConnectionIDs, id)
		case "set_viewport":
			copyOf.Viewport = *op.Viewport
		case "select_nodes":
			copyOf.SelectedNodeIDs = append([]string(nil), op.IDs...)
		}
	}
	verification.OverlapWarnings = detectMCPOverlaps(copyOf.Nodes)
	verification.AfterHash, _ = hashMCPSnapshot(copyOf)
	return copyOf, verification, nil
}

func hashMCPSnapshot(snapshot MCPCanvasSnapshot) (string, error) {
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	return model.CanvasStateHash(raw)
}
func cloneMCPSnapshot(s MCPCanvasSnapshot) (MCPCanvasSnapshot, error) {
	raw, e := json.Marshal(s)
	if e != nil {
		return s, e
	}
	return DecodeMCPCanvasSnapshot(raw)
}
func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	raw, _ := json.Marshal(in)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}
func mcpConnectionKey(c MCPCanvasConnection) string {
	return strings.Join([]string{c.FromNodeID, c.ToNodeID, c.FromHandleID, c.ToHandleID}, "\x00")
}
func mcpOpPosition(op MCPCanvasOp) MCPPosition {
	if op.Position != nil {
		return *op.Position
	}
	return MCPPosition{X: valueFloat(op.X), Y: valueFloat(op.Y)}
}
func valueFloat(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}
func mcpDimension(v, def float64) float64 {
	if v == 0 {
		return def
	}
	return v
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func validateMCPNodeNumbers(issue func(int, string), i int, p *MCPPosition, x, y, w, h *float64) {
	if p != nil && (!finite(p.X) || !finite(p.Y)) {
		issue(i, "节点坐标必须是有限数字")
	}
	if x != nil && !finite(*x) {
		issue(i, "节点 x 坐标必须是有限数字")
	}
	if y != nil && !finite(*y) {
		issue(i, "节点 y 坐标必须是有限数字")
	}
	if w != nil && (!finite(*w) || *w <= 0 || *w > 10000) {
		issue(i, "节点 width 必须在 (0,10000] 范围内")
	}
	if h != nil && (!finite(*h) || *h <= 0 || *h > 10000) {
		issue(i, "节点 height 必须在 (0,10000] 范围内")
	}
}
func numberFromPatch(p map[string]any, k string) *float64 {
	v, ok := p[k]
	if !ok {
		return nil
	}
	n, ok := v.(float64)
	if !ok {
		return nil
	}
	return &n
}

func pointerIfNonZero(v float64) *float64 {
	if v == 0 {
		return nil
	}
	return &v
}
func applyMCPNodePatch(node *MCPCanvasNode, op MCPCanvasOp) {
	patch := op.Patch
	if v, ok := patch["title"].(string); ok {
		node.Title = v
	}
	if v, ok := patch["width"].(float64); ok {
		node.Width = v
	}
	if v, ok := patch["height"].(float64); ok {
		node.Height = v
	}
	if raw, ok := patch["position"].(map[string]any); ok {
		if x, ok := raw["x"].(float64); ok {
			node.Position.X = x
		}
		if y, ok := raw["y"].(float64); ok {
			node.Position.Y = y
		}
	}
	if op.Position != nil {
		node.Position = *op.Position
	}
	if op.Metadata != nil {
		for k, v := range op.Metadata {
			node.Metadata[k] = v
		}
	}
	if raw, ok := patch["metadata"].(map[string]any); ok {
		for k, v := range raw {
			node.Metadata[k] = v
		}
	}
}
func mcpIsMediaType(t string) bool       { return t == "image" || t == "video" || t == "audio" }
func hasMCPStatus(m map[string]any) bool { _, ok := m["status"]; return ok }
func hasMCPStatusMap(m map[string]any) bool {
	v, ok := m["metadata"].(map[string]any)
	return ok && hasMCPStatus(v)
}
func mcpContainsString(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
func detectMCPOverlaps(nodes []MCPCanvasNode) []string {
	warnings := []string{}
	for i := 0; i < len(nodes); i++ {
		for j := i + 1; j < len(nodes); j++ {
			a, b := nodes[i], nodes[j]
			if a.Position.X < b.Position.X+b.Width && a.Position.X+a.Width > b.Position.X && a.Position.Y < b.Position.Y+b.Height && a.Position.Y+a.Height > b.Position.Y {
				warnings = append(warnings, fmt.Sprintf("节点「%s」与「%s」发生重叠", a.Title, b.Title))
			}
		}
	}
	return warnings
}

func containsInlineMCPMedia(value any) bool {
	switch v := value.(type) {
	case string:
		return strings.HasPrefix(strings.ToLower(strings.TrimSpace(v)), "data:")
	case []any:
		for _, x := range v {
			if containsInlineMCPMedia(x) {
				return true
			}
		}
	case map[string]any:
		for _, x := range v {
			if containsInlineMCPMedia(x) {
				return true
			}
		}
	}
	return false
}
