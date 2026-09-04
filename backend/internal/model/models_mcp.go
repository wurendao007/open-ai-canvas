package model

import "time"

// MCPDeviceSession stores the one-time device authorization state. Secrets are
// represented only by hashes so an interrupted approval flow cannot be replayed
// from a database backup.
type MCPDeviceSession struct {
	ID             string     `json:"id" gorm:"primaryKey;size:36"`
	UserID         string     `json:"userId" gorm:"index;size:36"`
	DeviceCodeHash string     `json:"-" gorm:"uniqueIndex;size:64"`
	UserCodeHash   string     `json:"-" gorm:"uniqueIndex;size:64"`
	ClientName     string     `json:"clientName" gorm:"size:160"`
	ScopesJSON     string     `json:"-" gorm:"type:text"`
	Status         string     `json:"status" gorm:"index;size:24;index:idx_mcp_device_sessions_status_expiry,priority:1"`
	ExpiresAt      time.Time  `json:"expiresAt" gorm:"index;index:idx_mcp_device_sessions_status_expiry,priority:2"`
	ApprovedAt     *time.Time `json:"approvedAt,omitempty"`
	ConsumedAt     *time.Time `json:"consumedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// MCPToken stores access and refresh token families. Plain tokens never cross
// the persistence boundary; rotation and revocation remain auditable.
type MCPToken struct {
	ID              string     `json:"id" gorm:"primaryKey;size:36"`
	UserID          string     `json:"userId" gorm:"index;size:36;index:idx_mcp_tokens_user_status_expiry,priority:1"`
	DeviceSessionID string     `json:"deviceSessionId" gorm:"index;size:36"`
	TokenHash       string     `json:"-" gorm:"uniqueIndex;size:64"`
	TokenFamilyID   string     `json:"tokenFamilyId" gorm:"index;size:36;index:idx_mcp_tokens_family_status,priority:1"`
	ScopesJSON      string     `json:"-" gorm:"type:text"`
	Status          string     `json:"status" gorm:"index;size:24;index:idx_mcp_tokens_user_status_expiry,priority:2;index:idx_mcp_tokens_family_status,priority:2"`
	ExpiresAt       time.Time  `json:"expiresAt" gorm:"index;index:idx_mcp_tokens_user_status_expiry,priority:3"`
	RotatedAt       *time.Time `json:"rotatedAt,omitempty"`
	RevokedAt       *time.Time `json:"revokedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}
