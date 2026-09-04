package service

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CanvasMCPProject is the versioned canvas representation exposed to remote
// MCP consumers. Payload is kept separate from version metadata so browser
// snapshots remain lossless.
type CanvasMCPProject struct {
	ID        string          `json:"id"`
	ProjectID string          `json:"projectId,omitempty"`
	Title     string          `json:"title"`
	Payload   json.RawMessage `json:"payload"`
	Revision  int64           `json:"revision"`
	StateHash string          `json:"stateHash"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type CanvasMCPProjectSummary struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId,omitempty"`
	Title     string    `json:"title"`
	Revision  int64     `json:"revision"`
	StateHash string    `json:"stateHash"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type CanvasMCPPrecondition struct {
	Revision  int64  `json:"revision"`
	StateHash string `json:"stateHash"`
}

var canvasHashTemporaryFields = map[string]struct{}{
	"clientId":   {},
	"revision":   {},
	"stateHash":  {},
	"state_hash": {},
}

// NormalizeCanvasPayload returns the canonical JSON bytes used for a canvas
// state digest. Only server-temporary root fields are removed.
func NormalizeCanvasPayload(raw []byte) ([]byte, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("画布数据不是有效 JSON：%w", err)
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("画布数据必须是 JSON 对象")
	}
	if containsInlineCanvasMedia(value) {
		return nil, errors.New("画布数据包含内嵌媒体")
	}
	for key := range canvasHashTemporaryFields {
		delete(object, key)
	}
	return json.Marshal(object)
}

func CanvasStateHash(raw []byte) (string, error) {
	normalized, err := NormalizeCanvasPayload(raw)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(normalized)
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func containsInlineCanvasMedia(value any) bool {
	switch item := value.(type) {
	case string:
		return strings.HasPrefix(strings.ToLower(strings.TrimSpace(item)), "data:")
	case []any:
		for _, child := range item {
			if containsInlineCanvasMedia(child) {
				return true
			}
		}
	case map[string]any:
		for _, child := range item {
			if containsInlineCanvasMedia(child) {
				return true
			}
		}
	}
	return false
}
