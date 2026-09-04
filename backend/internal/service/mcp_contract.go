package service

import (
	"encoding/json"
	"time"

	"infinite-canvas/backend/internal/model"
)

// CanvasMCPProject is the versioned canvas representation exposed to remote
// MCP consumers. Payload is kept separate from version metadata so browser
// snapshots remain lossless.
type CanvasMCPProject struct {
	ID         string          `json:"id"`
	ProjectID  string          `json:"projectId,omitempty"`
	Title      string          `json:"title"`
	Payload    json.RawMessage `json:"payload"`
	Revision   int64           `json:"revision"`
	StateHash  string          `json:"stateHash"`
	HashSource string          `json:"hashSource"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

type CanvasMCPProjectSummary struct {
	ID         string    `json:"id"`
	ProjectID  string    `json:"projectId,omitempty"`
	Title      string    `json:"title"`
	Revision   int64     `json:"revision"`
	StateHash  string    `json:"stateHash"`
	HashSource string    `json:"hashSource"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type CanvasMCPPrecondition struct {
	Revision  int64  `json:"revision"`
	StateHash string `json:"stateHash"`
}

func NormalizeCanvasPayload(raw []byte) ([]byte, error) {
	return model.NormalizeCanvasPayload(raw)
}

func CanvasStateHash(raw []byte) (string, error) {
	return model.CanvasStateHash(raw)
}
