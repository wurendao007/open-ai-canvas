package model

import "time"

// MCPAuditEvent records a redacted MCP invocation. It intentionally stores no
// token, cookie, API key, media URL, prompt or raw payload.
type MCPAuditEvent struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	UserID         string    `json:"userId" gorm:"index;size:36"`
	TokenFamilyID  string    `json:"tokenFamilyId" gorm:"index;size:36"`
	CanvasID       string    `json:"canvasId" gorm:"index;size:80"`
	Tool           string    `json:"tool" gorm:"size:64;index"`
	RequestID      string    `json:"requestId" gorm:"size:96;index"`
	OperationCount int       `json:"operationCount"`
	RevisionBefore int64     `json:"revisionBefore"`
	RevisionAfter  int64     `json:"revisionAfter"`
	SummaryJSON    string    `json:"summaryJson,omitempty" gorm:"type:text"`
	CreatedAt      time.Time `json:"createdAt" gorm:"index"`
}
