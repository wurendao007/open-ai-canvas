package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// GetMCPProject returns a server-versioned project after ownership validation.
func (s *Service) GetMCPProject(userID, id string) (*CanvasMCPProject, error) {
	project, err := s.repo.CanvasProjectForUser(userID, strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NewAppError(http.StatusNotFound, "画布不存在")
		}
		return nil, err
	}
	return canvasMCPProjectFromModel(project), nil
}

func (s *Service) ListMCPProjects(userID string) ([]CanvasMCPProjectSummary, error) {
	projects, err := s.repo.CanvasProjectSummaries(userID)
	if err != nil {
		return nil, err
	}
	result := make([]CanvasMCPProjectSummary, 0, len(projects))
	for i := range projects {
		result = append(result, CanvasMCPProjectSummary{ID: projects[i].ID, ProjectID: projects[i].ProjectID, Title: projects[i].Title, Revision: projects[i].Revision, StateHash: projects[i].StateHash, HashSource: "server", CreatedAt: projects[i].CreatedAt, UpdatedAt: projects[i].UpdatedAt})
	}
	return result, nil
}

// SaveCanvasProjectWithPrecondition applies a conditional write. New projects
// begin at revision zero; existing projects must provide the exact server pair.
func (s *Service) SaveCanvasProjectWithPrecondition(userID string, raw json.RawMessage, precondition *CanvasMCPPrecondition) (*CanvasMCPProject, error) {
	project, err := canvasProjectFromJSON(userID, raw)
	if err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if err := s.validateCanvasMediaAssets(userID, raw); err != nil {
		return nil, err
	}
	existing, existingErr := s.repo.CanvasProjectForUser(userID, project.ID)
	if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return nil, existingErr
	}
	if existing == nil {
		if precondition != nil {
			return nil, NewAppError(http.StatusConflict, "画布已被其他窗口或 MCP 删除，请重新加载后再试")
		}
		project.StateHash, err = model.CanvasStateHash(raw)
		if err != nil {
			return nil, BadAuthRequest(err.Error())
		}
		usage, err := s.repo.UserStorageUsage(userID)
		if err != nil {
			return nil, err
		}
		if err := validateStructuredStorageQuotaWithPolicy(usage, "canvas", true, int64(len(raw)), policy.Resource); err != nil {
			return nil, err
		}
		if err := s.repo.UpsertCanvasProject(&project); err != nil {
			return nil, err
		}
		s.recordActivity(userID, "canvas", 1)
		return canvasMCPProjectFromModel(&project), nil
	}
	if precondition == nil {
		return nil, NewAppError(http.StatusPreconditionRequired, "缺少画布版本前置条件")
	}
	if existing.Revision != precondition.Revision || existing.StateHash != precondition.StateHash {
		return nil, NewAppError(http.StatusConflict, "画布已被其他窗口或 MCP 修改，请重新加载/合并")
	}
	project.CreatedAt = existing.CreatedAt
	project.Revision = existing.Revision + 1
	project.StateHash, err = model.CanvasStateHash(raw)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return nil, err
	}
	existingBytes := int64(len([]byte(existing.PayloadJSON)))
	if err := validateStructuredStorageQuotaWithPolicy(usage, "canvas", false, int64(len(raw))-existingBytes, policy.Resource); err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateCanvasProjectIfPrecondition(&project, precondition.Revision, precondition.StateHash)
	if err != nil {
		return nil, err
	}
	if !updated {
		return nil, NewAppError(http.StatusConflict, "画布已被其他窗口或 MCP 修改，请重新加载/合并")
	}
	if existing.PayloadJSON != project.PayloadJSON || existing.Title != project.Title || existing.ProjectID != project.ProjectID {
		s.recordActivity(userID, "canvas", 1)
	}
	return canvasMCPProjectFromModel(&project), nil
}

func canvasMCPProjectFromModel(project *model.CanvasProject) *CanvasMCPProject {
	return &CanvasMCPProject{ID: project.ID, ProjectID: project.ProjectID, Title: project.Title, Payload: json.RawMessage(project.PayloadJSON), Revision: project.Revision, StateHash: project.StateHash, HashSource: "server", CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt}
}
