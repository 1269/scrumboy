package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"testing"
	"time"

	"scrumboy/internal/store"
)

type boardLegacyReadContractResponse struct {
	Project struct {
		ID   int64  `json:"id"`
		Slug string `json:"slug"`
	} `json:"project"`
	ColumnOrder []struct {
		Key string `json:"key"`
	} `json:"columnOrder"`
	Tags []struct {
		Name string `json:"name"`
	} `json:"tags"`
	Columns map[string][]struct {
		ID    int64  `json:"id"`
		Title string `json:"title"`
	} `json:"columns"`
}

func TestBoardLegacyRead_RESTCombinedFiltersUnpagedResponseContract(t *testing.T) {
	ts, sqlDB, cleanup := newTestHTTPServer(t, "full")
	defer cleanup()

	client := newCookieClient(t)
	ownerJSON := bootstrapUserClient(
		t,
		client,
		ts.URL,
		"Owner",
		"board-legacy-read-contract@example.com",
		"password123",
	)
	ownerID := int64(ownerJSON["id"].(float64))
	ctxOwner := store.WithUserID(context.Background(), ownerID)
	st := store.New(sqlDB, nil)

	project, err := st.CreateProject(ctxOwner, "Legacy Board Read Contract")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	start := time.Now().UTC()
	sprint, err := st.CreateSprint(
		ctxOwner,
		project.ID,
		"Legacy Board Read Sprint",
		start,
		start.Add(14*24*time.Hour),
	)
	if err != nil {
		t.Fatalf("CreateSprint: %v", err)
	}

	createTodo := func(
		title string,
		body string,
		tags []string,
		assigneeUserID *int64,
		sprintID *int64,
	) store.Todo {
		t.Helper()
		todo, err := st.CreateTodo(ctxOwner, project.ID, store.CreateTodoInput{
			Title:          title,
			Body:           body,
			Tags:           tags,
			AssigneeUserID: assigneeUserID,
			SprintID:       sprintID,
		}, store.ModeFull)
		if err != nil {
			t.Fatalf("CreateTodo(%q): %v", title, err)
		}
		return todo
	}

	const matchingTodoCount = 23
	matchingIDs := make([]int64, 0, matchingTodoCount)
	for i := range matchingTodoCount {
		todo := createTodo(
			"Matching "+strconv.Itoa(i+1),
			"contains the needle",
			[]string{"focus"},
			&ownerID,
			&sprint.ID,
		)
		matchingIDs = append(matchingIDs, todo.ID)
	}

	createTodo("Wrong tag", "contains the needle", []string{"other"}, &ownerID, &sprint.ID)
	createTodo("Wrong search", "contains only hay", []string{"focus"}, &ownerID, &sprint.ID)
	createTodo("Wrong assignee", "contains the needle", []string{"focus"}, nil, &sprint.ID)
	createTodo("Wrong sprint", "contains the needle", []string{"focus"}, &ownerID, nil)

	wantNewestIDs := slices.Clone(matchingIDs)
	slices.Reverse(wantNewestIDs)

	query := url.Values{}
	query.Set("tag", "focus")
	query.Set("search", "  needle  ")
	query.Set("assignee", "me")
	query.Set("sprintId", strconv.FormatInt(sprint.Number, 10))
	query.Set("sort", "newest")

	var board boardLegacyReadContractResponse
	resp, body := doJSON(
		t,
		client,
		http.MethodGet,
		ts.URL+"/api/projects/"+strconv.FormatInt(project.ID, 10)+"/board?"+query.Encode(),
		nil,
		&board,
	)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET legacy board: status=%d body=%s", resp.StatusCode, string(body))
	}

	if board.Project.ID != project.ID || board.Project.Slug != project.Slug {
		t.Fatalf("unexpected project: %+v", board.Project)
	}
	if len(board.ColumnOrder) == 0 {
		t.Fatal("expected columnOrder array")
	}
	if len(board.Tags) == 0 {
		t.Fatal("expected tags array")
	}
	if board.Columns == nil {
		t.Fatal("expected columns object")
	}

	for _, column := range board.ColumnOrder {
		if _, ok := board.Columns[column.Key]; !ok {
			t.Fatalf("columns missing workflow lane %q", column.Key)
		}
	}

	backlog := board.Columns[store.DefaultColumnBacklog]
	if len(backlog) != matchingTodoCount {
		t.Fatalf("backlog count = %d, want %d", len(backlog), matchingTodoCount)
	}
	gotBacklogIDs := make([]int64, 0, len(backlog))
	for _, todo := range backlog {
		gotBacklogIDs = append(gotBacklogIDs, todo.ID)
	}
	if !slices.Equal(gotBacklogIDs, wantNewestIDs) {
		t.Fatalf("backlog IDs = %v, want exact newest-first IDs %v", gotBacklogIDs, wantNewestIDs)
	}

	var gotAllIDs []int64
	for _, column := range board.ColumnOrder {
		for _, todo := range board.Columns[column.Key] {
			gotAllIDs = append(gotAllIDs, todo.ID)
		}
	}
	if len(gotAllIDs) != matchingTodoCount {
		t.Fatalf("all-lane todo count = %d, want %d; IDs=%v", len(gotAllIDs), matchingTodoCount, gotAllIDs)
	}
	if !slices.Equal(gotAllIDs, wantNewestIDs) {
		t.Fatalf("all-lane IDs = %v, want exact matching IDs %v", gotAllIDs, wantNewestIDs)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("decode raw legacy response: %v", err)
	}
	for _, field := range []string{"project", "columnOrder", "tags", "columns"} {
		if _, ok := raw[field]; !ok {
			t.Fatalf("legacy response missing %q: %s", field, string(body))
		}
	}
	if _, ok := raw["columnsMeta"]; ok {
		t.Fatalf("legacy response unexpectedly contains columnsMeta: %s", string(body))
	}
}

func TestBoardLegacyRead_RESTAnonymousModeHidesRouteBeforeIDValidation(t *testing.T) {
	ts, _, cleanup := newTestHTTPServer(t, "anonymous")
	defer cleanup()

	var got apiErrorEnvelope
	resp, body := doJSON(
		t,
		ts.Client(),
		http.MethodGet,
		ts.URL+"/api/projects/not-an-id/board",
		nil,
		&got,
	)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET anonymous legacy board: status=%d body=%s", resp.StatusCode, string(body))
	}
	assertAPIError(t, got, "NOT_FOUND", "")
	if got.Error.Message != "not found" {
		t.Fatalf("error message = %q, want %q", got.Error.Message, "not found")
	}
	if reason, _ := got.Error.Details["reason"].(string); reason == "invalid_project_id" {
		t.Fatalf("anonymous route reached project ID validation: %+v", got.Error)
	}
	if field, _ := got.Error.Details["field"].(string); field == "projectId" {
		t.Fatalf("anonymous route exposed project ID validation: %+v", got.Error)
	}
}
