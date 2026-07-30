package board

import (
	"context"

	"scrumboy/internal/store"
)

// LegacyResult names the values returned by the unpaged numeric-ID board
// read.
type LegacyResult struct {
	Project  store.Project
	Tags     []store.TagCount
	Workflow []store.WorkflowColumn
	Columns  map[string][]store.Todo
}

// LegacyReadStore is the persistence capability required by the unpaged
// numeric-ID board-read use case.
type LegacyReadStore interface {
	GetBoard(
		ctx context.Context,
		pc *store.ProjectContext,
		tagFilter string,
		searchFilter string,
		assigneeFilter store.AssigneeFilter,
		sprintFilter store.SprintFilter,
		sortOrder store.SortOrder,
	) (
		store.Project,
		[]store.TagCount,
		[]store.WorkflowColumn,
		map[string][]store.Todo,
		error,
	)
}

// ReadService is the application surface for REST board reads.
//
// Initial and lane reads retain their existing service implementations. The
// legacy read remains a lossless delegation through its own narrow store port.
type ReadService struct {
	initial      *Service
	lane         *LaneService
	legacyAccess LegacyReadAccessStore
	legacy       LegacyReadStore
}

func NewReadService(
	initialStore ReadStore,
	laneStore LaneReadStore,
	legacyAccessStore LegacyReadAccessStore,
	legacyStore LegacyReadStore,
) *ReadService {
	return &ReadService{
		initial:      NewService(initialStore),
		lane:         NewLaneService(laneStore),
		legacyAccess: legacyAccessStore,
		legacy:       legacyStore,
	}
}

func (s *ReadService) ReadInitial(
	ctx context.Context,
	pc *store.ProjectContext,
	query Query,
) (Result, error) {
	return s.initial.ReadInitial(ctx, pc, query)
}

func (s *ReadService) ReadLane(
	ctx context.Context,
	pc *store.ProjectContext,
	query LaneQuery,
) (LaneResult, error) {
	return s.lane.Read(ctx, pc, query)
}
