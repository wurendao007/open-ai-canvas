package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) CreateMCPDeviceSession(session *model.MCPDeviceSession) error {
	return r.db.Create(session).Error
}

func (r *Repository) MCPDeviceSessionByDeviceCode(hash string) (*model.MCPDeviceSession, error) {
	var session model.MCPDeviceSession
	if err := r.db.First(&session, "device_code_hash = ?", hash).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) MCPDeviceSessionByUserCode(hash string) (*model.MCPDeviceSession, error) {
	var session model.MCPDeviceSession
	if err := r.db.First(&session, "user_code_hash = ?", hash).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) ApproveMCPDeviceSession(userID, userCodeHash, status string, now time.Time) (*model.MCPDeviceSession, error) {
	var session model.MCPDeviceSession
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&session, "user_code_hash = ?", userCodeHash).Error; err != nil {
			return err
		}
		if session.Status != "pending" || !now.Before(session.ExpiresAt) {
			return gorm.ErrRecordNotFound
		}
		updates := map[string]any{"status": status, "user_id": userID, "updated_at": now}
		if status == "approved" {
			updates["approved_at"] = now
		}
		if err := tx.Model(&session).Updates(updates).Error; err != nil {
			return err
		}
		session.UserID = userID
		session.Status = status
		session.UpdatedAt = now
		if status == "approved" {
			session.ApprovedAt = &now
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) ConsumeApprovedMCPDeviceSession(deviceCodeHash string, now time.Time) (*model.MCPDeviceSession, error) {
	var session model.MCPDeviceSession
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&session, "device_code_hash = ?", deviceCodeHash).Error; err != nil {
			return err
		}
		if session.Status == "pending" && !now.Before(session.ExpiresAt) {
			session.Status = "expired"
			return tx.Model(&session).Updates(map[string]any{"status": "expired", "updated_at": now}).Error
		}
		if session.Status != "approved" {
			return nil
		}
		if !now.Before(session.ExpiresAt) {
			session.Status = "expired"
			return tx.Model(&session).Updates(map[string]any{"status": "expired", "updated_at": now}).Error
		}
		session.ConsumedAt = &now
		if err := tx.Model(&session).Updates(map[string]any{"status": "consumed", "consumed_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		session.Status = "approved"
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) UpdateMCPDeviceSessionStatus(id, status string, now time.Time) error {
	return r.db.Model(&model.MCPDeviceSession{}).Where("id = ?", id).
		Updates(map[string]any{"status": status, "updated_at": now}).Error
}

func (r *Repository) CreateMCPToken(token *model.MCPToken) error {
	return r.db.Create(token).Error
}

func (r *Repository) MCPTokenByHash(hash string) (*model.MCPToken, error) {
	var token model.MCPToken
	if err := r.db.First(&token, "token_hash = ?", hash).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func (r *Repository) RotateMCPRefreshToken(oldHash string, now time.Time, replacement *model.MCPToken) (*model.MCPToken, error) {
	var old model.MCPToken
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&old, "token_hash = ?", oldHash).Error; err != nil {
			return err
		}
		if old.Status != "refresh" || !now.Before(old.ExpiresAt) || old.RotatedAt != nil || old.RevokedAt != nil {
			if old.TokenFamilyID != "" {
				_ = tx.Model(&model.MCPToken{}).Where("token_family_id = ?", old.TokenFamilyID).
					Updates(map[string]any{"status": "revoked", "revoked_at": now, "updated_at": now}).Error
			}
			return gorm.ErrInvalidData
		}
		if err := tx.Model(&old).Updates(map[string]any{"status": "rotated", "rotated_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		return tx.Create(replacement).Error
	})
	if err != nil {
		return nil, err
	}
	return &old, nil
}

func (r *Repository) RevokeMCPTokenFamily(familyID string, now time.Time) error {
	return r.db.Model(&model.MCPToken{}).Where("token_family_id = ?", familyID).
		Updates(map[string]any{"status": "revoked", "revoked_at": now, "updated_at": now}).Error
}
