package board

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"scrumboy/internal/store"
)

type recordingLegacyReadStore struct {
	calls int

	ctx            context.Context
	projectContext *store.ProjectContext
	tagFilter      string
	searchFilter   string
	assigneeFilter store.AssigneeFilter
	sprintFilter   store.SprintFilter
	sortOrder      store.SortOrder

	project  store.Project
	tags     []store.TagCount
	workflow []store.WorkflowColumn
	columns  map[string][]store.Todo
	err      error
}

func (s *recordingLegacyReadStore) GetBoard(
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
) {
	s.calls++
	s.ctx = ctx
	s.projectContext = pc
	s.tagFilter = tagFilter
	s.searchFilter = searchFilter
	s.assigneeFilter = assigneeFilter
	s.sprintFilter = sprintFilter
	s.sortOrder = sortOrder

	return s.project, s.tags, s.workflow, s.columns, s.err
}

type readServiceContextKey struct{}

func TestReadServiceReadInitial_DelegatesToExistingService(t *testing.T) {
	assigneeFilter, err := store.ParseAssigneeFilter("42", nil)
	if err != nil {
		t.Fatalf("ParseAssigneeFilter: %v", err)
	}

	ctx := context.WithValue(context.Background(), readServiceContextKey{}, "initial")
	pc := &store.ProjectContext{Project: store.Project{ID: 7, Slug: "project-slug"}}
	query := Query{
		TagFilter:      "focus",
		SearchFilter:   "needle",
		AssigneeFilter: assigneeFilter,
		SprintFilter:   store.SprintFilter{Mode: "none"},
		SortOrder:      store.SortOrderNewest,
		LimitPerLane:   17,
	}
	initialStore := &recordingReadStore{
		project: pc.Project,
		tags:    []store.TagCount{{Name: "focus", Count: 1}},
		workflow: []store.WorkflowColumn{{
			Key:  store.DefaultColumnBacklog,
			Name: "Backlog",
		}},
		columns: map[string][]store.Todo{
			store.DefaultColumnBacklog: {{ID: 101}},
		},
		columnsMeta: map[string]store.LaneMeta{
			store.DefaultColumnBacklog: {TotalCount: 1},
		},
	}
	laneStore := &recordingLaneReadStore{}
	legacyStore := &recordingLegacyReadStore{}

	result, err := NewReadService(initialStore, laneStore, legacyStore).ReadInitial(ctx, pc, query)
	if err != nil {
		t.Fatalf("ReadInitial: %v", err)
	}

	if initialStore.calls != 1 {
		t.Fatalf("GetBoardPaged calls = %d, want 1", initialStore.calls)
	}
	if laneStore.calls != 0 || legacyStore.calls != 0 {
		t.Fatalf("unexpected other-port calls: lane=%d legacy=%d", laneStore.calls, legacyStore.calls)
	}
	if initialStore.ctx != ctx || initialStore.projectContext != pc {
		t.Fatal("ReadInitial changed the context or project-context pointer")
	}
	if initialStore.tagFilter != query.TagFilter ||
		initialStore.searchFilter != query.SearchFilter ||
		!reflect.DeepEqual(initialStore.assigneeFilter, query.AssigneeFilter) ||
		!reflect.DeepEqual(initialStore.sprintFilter, query.SprintFilter) ||
		initialStore.sortOrder != query.SortOrder ||
		initialStore.limitPerLane != query.LimitPerLane {
		t.Fatalf("ReadInitial changed the normalized query: store=%+v query=%+v", initialStore, query)
	}
	want := Result{
		Project:     initialStore.project,
		Tags:        initialStore.tags,
		Workflow:    initialStore.workflow,
		Columns:     initialStore.columns,
		ColumnsMeta: initialStore.columnsMeta,
	}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("result = %#v, want %#v", result, want)
	}
}

func TestReadServiceReadLane_DelegatesToExistingService(t *testing.T) {
	assigneeFilter, err := store.ParseAssigneeFilter("42", nil)
	if err != nil {
		t.Fatalf("ParseAssigneeFilter: %v", err)
	}

	ctx := context.WithValue(context.Background(), readServiceContextKey{}, "lane")
	pc := &store.ProjectContext{Project: store.Project{ID: 7, Slug: "project-slug"}}
	query := LaneQuery{
		ColumnKey:      store.DefaultColumnBacklog,
		Limit:          17,
		AfterA:         301,
		AfterB:         302,
		TagFilter:      "focus",
		SearchFilter:   "needle",
		AssigneeFilter: assigneeFilter,
		SprintFilter:   store.SprintFilter{Mode: "none"},
		SortOrder:      store.SortOrderOldest,
	}
	initialStore := &recordingReadStore{}
	laneStore := &recordingLaneReadStore{
		items:      []store.Todo{{ID: 101}},
		nextCursor: "10:101",
		hasMore:    true,
	}
	legacyStore := &recordingLegacyReadStore{}

	result, err := NewReadService(initialStore, laneStore, legacyStore).ReadLane(ctx, pc, query)
	if err != nil {
		t.Fatalf("ReadLane: %v", err)
	}

	if laneStore.calls != 1 {
		t.Fatalf("ListTodosForBoardLane calls = %d, want 1", laneStore.calls)
	}
	if initialStore.calls != 0 || legacyStore.calls != 0 {
		t.Fatalf("unexpected other-port calls: initial=%d legacy=%d", initialStore.calls, legacyStore.calls)
	}
	if laneStore.ctx != ctx || laneStore.projectID != pc.Project.ID {
		t.Fatal("ReadLane changed the context or project ID")
	}
	if laneStore.columnKey != query.ColumnKey ||
		laneStore.limit != query.Limit ||
		laneStore.afterA != query.AfterA ||
		laneStore.afterB != query.AfterB ||
		laneStore.tagFilter != query.TagFilter ||
		laneStore.searchFilter != query.SearchFilter ||
		!reflect.DeepEqual(laneStore.assigneeFilter, query.AssigneeFilter) ||
		!reflect.DeepEqual(laneStore.sprintFilter, query.SprintFilter) ||
		laneStore.sortOrder != query.SortOrder {
		t.Fatalf("ReadLane changed the normalized query: store=%+v query=%+v", laneStore, query)
	}
	want := LaneResult{
		Items:      laneStore.items,
		NextCursor: laneStore.nextCursor,
		HasMore:    laneStore.hasMore,
	}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("result = %#v, want %#v", result, want)
	}
}

func TestReadServiceReadLegacy_DelegatesExactlyAndNamesResult(t *testing.T) {
	assigneeFilter, err := store.ParseAssigneeFilter("42", nil)
	if err != nil {
		t.Fatalf("ParseAssigneeFilter: %v", err)
	}

	ctx := context.WithValue(context.Background(), readServiceContextKey{}, "legacy")
	pc := &store.ProjectContext{
		Project: store.Project{ID: 7, Slug: "project-slug"},
		Role:    store.RoleViewer,
	}
	query := LegacyQuery{
		TagFilter:      "make space",
		SearchFilter:   "needle",
		AssigneeFilter: assigneeFilter,
		SprintFilter:   store.SprintFilter{Mode: "sprint_number", SprintNumber: 3},
		SortOrder:      store.SortOrderNewest,
	}
	initialStore := &recordingReadStore{}
	laneStore := &recordingLaneReadStore{}
	legacyStore := &recordingLegacyReadStore{
		project:  pc.Project,
		tags:     []store.TagCount{{Name: "focus", Count: 2}},
		workflow: []store.WorkflowColumn{{Key: store.DefaultColumnBacklog, Name: "Backlog"}},
		columns: map[string][]store.Todo{
			store.DefaultColumnBacklog: {{ID: 101, Title: "Todo"}},
		},
	}

	result, err := NewReadService(initialStore, laneStore, legacyStore).ReadLegacy(ctx, pc, query)
	if err != nil {
		t.Fatalf("ReadLegacy: %v", err)
	}

	if legacyStore.calls != 1 {
		t.Fatalf("GetBoard calls = %d, want 1", legacyStore.calls)
	}
	if initialStore.calls != 0 || laneStore.calls != 0 {
		t.Fatalf("unexpected other-port calls: initial=%d lane=%d", initialStore.calls, laneStore.calls)
	}
	if legacyStore.ctx != ctx {
		t.Fatal("ReadLegacy did not forward the same context")
	}
	if legacyStore.projectContext != pc {
		t.Fatal("ReadLegacy did not forward the same project context pointer")
	}
	if legacyStore.tagFilter != query.TagFilter {
		t.Fatalf("tagFilter = %q, want %q", legacyStore.tagFilter, query.TagFilter)
	}
	if legacyStore.searchFilter != query.SearchFilter {
		t.Fatalf("searchFilter = %q, want %q", legacyStore.searchFilter, query.SearchFilter)
	}
	if !reflect.DeepEqual(legacyStore.assigneeFilter, query.AssigneeFilter) {
		t.Fatal("ReadLegacy changed the assignee filter")
	}
	if !reflect.DeepEqual(legacyStore.sprintFilter, query.SprintFilter) {
		t.Fatal("ReadLegacy changed the sprint filter")
	}
	if legacyStore.sortOrder != query.SortOrder {
		t.Fatalf("sortOrder = %q, want %q", legacyStore.sortOrder, query.SortOrder)
	}

	want := LegacyResult{
		Project:  legacyStore.project,
		Tags:     legacyStore.tags,
		Workflow: legacyStore.workflow,
		Columns:  legacyStore.columns,
	}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("result = %#v, want %#v", result, want)
	}
}

func TestReadServiceReadLegacy_ReturnsStoreErrorUnchanged(t *testing.T) {
	sentinel := errors.New("sentinel")
	storeErr := fmt.Errorf("legacy board read failed: %w", sentinel)
	initialStore := &recordingReadStore{}
	laneStore := &recordingLaneReadStore{}
	legacyStore := &recordingLegacyReadStore{err: storeErr}

	result, err := NewReadService(initialStore, laneStore, legacyStore).ReadLegacy(
		context.Background(),
		&store.ProjectContext{},
		LegacyQuery{},
	)

	if err != storeErr {
		t.Fatalf("error = %v, want original store error %v", err, storeErr)
	}
	if !errors.Is(err, sentinel) {
		t.Fatalf("error %v no longer matches sentinel", err)
	}
	if !reflect.DeepEqual(result, LegacyResult{}) {
		t.Fatalf("result on error = %#v, want zero value", result)
	}
	if legacyStore.calls != 1 {
		t.Fatalf("GetBoard calls = %d, want 1", legacyStore.calls)
	}
	if initialStore.calls != 0 || laneStore.calls != 0 {
		t.Fatalf("unexpected other-port calls: initial=%d lane=%d", initialStore.calls, laneStore.calls)
	}
}
