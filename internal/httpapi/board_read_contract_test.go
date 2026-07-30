package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"

	"scrumboy/internal/store"
)

type boardReadContractResponse struct {
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
		Title string `json:"title"`
	} `json:"columns"`
	ColumnsMeta map[string]struct {
		HasMore    bool    `json:"hasMore"`
		NextCursor *string `json:"nextCursor"`
		TotalCount int     `json:"totalCount"`
	} `json:"columnsMeta"`
}

func TestBoardRead_RESTCombinedFiltersAndPaginationContract(t *testing.T) {
	ts, sqlDB, cleanup := newTestHTTPServer(t, "full")
	defer cleanup()

	client := newCookieClient(t)
	ownerJSON := bootstrapUserClient(t, client, ts.URL, "Owner", "board-read-contract@example.com", "password123")
	ownerID := int64(ownerJSON["id"].(float64))
	ctxOwner := store.WithUserID(context.Background(), ownerID)
	st := store.New(sqlDB, nil)

	project, err := st.CreateProject(ctxOwner, "Board Read Contract")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	start := time.Now().UTC()
	sprint, err := st.CreateSprint(ctxOwner, project.ID, "Board Read Sprint", start, start.Add(14*24*time.Hour))
	if err != nil {
		t.Fatalf("CreateSprint: %v", err)
	}

	createTodo := func(title, body string, tags []string, assigneeUserID, sprintID *int64) {
		t.Helper()
		if _, err := st.CreateTodo(ctxOwner, project.ID, store.CreateTodoInput{
			Title:          title,
			Body:           body,
			Tags:           tags,
			AssigneeUserID: assigneeUserID,
			SprintID:       sprintID,
		}, store.ModeFull); err != nil {
			t.Fatalf("CreateTodo(%q): %v", title, err)
		}
	}

	createTodo("Older matching", "contains the needle", []string{"focus"}, &ownerID, &sprint.ID)
	createTodo("Wrong tag", "contains the needle", []string{"other"}, &ownerID, &sprint.ID)
	createTodo("Wrong search", "contains only hay", []string{"focus"}, &ownerID, &sprint.ID)
	createTodo("Wrong assignee", "contains the needle", []string{"focus"}, nil, &sprint.ID)
	createTodo("Wrong sprint", "contains the needle", []string{"focus"}, &ownerID, nil)
	createTodo("Newer matching", "also contains the needle", []string{"focus"}, &ownerID, &sprint.ID)

	query := url.Values{}
	query.Set("tag", "focus")
	query.Set("search", "  needle  ")
	query.Set("assignee", "me")
	query.Set("sprintId", strconv.FormatInt(sprint.Number, 10))
	query.Set("sort", "newest")
	query.Set("limitPerLane", "1")

	var board boardReadContractResponse
	resp, body := doJSON(t, client, http.MethodGet, ts.URL+"/api/board/"+project.Slug+"?"+query.Encode(), nil, &board)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET board: status=%d body=%s", resp.StatusCode, string(body))
	}

	if board.Project.ID != project.ID || board.Project.Slug != project.Slug {
		t.Fatalf("unexpected project: %+v", board.Project)
	}
	if len(board.ColumnOrder) == 0 {
		t.Fatal("expected columnOrder")
	}
	if len(board.Tags) == 0 {
		t.Fatal("expected tags")
	}

	for _, column := range board.ColumnOrder {
		if _, ok := board.Columns[column.Key]; !ok {
			t.Fatalf("columns missing workflow lane %q", column.Key)
		}
		if _, ok := board.ColumnsMeta[column.Key]; !ok {
			t.Fatalf("columnsMeta missing workflow lane %q", column.Key)
		}
	}

	backlog := board.Columns[store.DefaultColumnBacklog]
	if len(backlog) != 1 || backlog[0].Title != "Newer matching" {
		t.Fatalf("unexpected filtered backlog: %+v", backlog)
	}

	meta := board.ColumnsMeta[store.DefaultColumnBacklog]
	if meta.TotalCount != 2 {
		t.Fatalf("backlog totalCount = %d, want 2", meta.TotalCount)
	}
	if !meta.HasMore {
		t.Fatal("expected backlog hasMore=true")
	}
	if meta.NextCursor == nil || *meta.NextCursor == "" {
		t.Fatal("expected non-empty backlog nextCursor")
	}
}
