package store

import (
	"context"
	"strconv"
	"testing"
)

func TestGetBoard_AssigneeFilter(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	owner, err := st.BootstrapUser(ctx, "assignee-filter-owner@example.com", "password", "Owner")
	if err != nil {
		t.Fatalf("BootstrapUser: %v", err)
	}
	ctxOwner := WithUserID(ctx, owner.ID)

	p, err := st.CreateProject(ctxOwner, "p")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	u1, err := st.CreateUser(ctx, "assignee-filter-u1@example.com", "password", "U1")
	if err != nil {
		t.Fatalf("CreateUser u1: %v", err)
	}
	if err := st.AddProjectMember(ctxOwner, owner.ID, p.ID, u1.ID, RoleMaintainer); err != nil {
		t.Fatalf("AddProjectMember u1: %v", err)
	}
	u2, err := st.CreateUser(ctx, "assignee-filter-u2@example.com", "password", "U2")
	if err != nil {
		t.Fatalf("CreateUser u2: %v", err)
	}
	if err := st.AddProjectMember(ctxOwner, owner.ID, p.ID, u2.ID, RoleMaintainer); err != nil {
		t.Fatalf("AddProjectMember u2: %v", err)
	}

	if _, err := st.CreateTodo(ctxOwner, p.ID, CreateTodoInput{Title: "Assigned to u1", AssigneeUserID: ptrInt64(u1.ID)}, ModeFull); err != nil {
		t.Fatalf("CreateTodo assigned u1: %v", err)
	}
	if _, err := st.CreateTodo(ctxOwner, p.ID, CreateTodoInput{Title: "Assigned to u2", AssigneeUserID: ptrInt64(u2.ID)}, ModeFull); err != nil {
		t.Fatalf("CreateTodo assigned u2: %v", err)
	}
	if _, err := st.CreateTodo(ctxOwner, p.ID, CreateTodoInput{Title: "Unassigned"}, ModeFull); err != nil {
		t.Fatalf("CreateTodo unassigned: %v", err)
	}

	pc, err := st.GetProjectContextForRead(ctxOwner, p.ID, ModeFull)
	if err != nil {
		t.Fatalf("GetProjectContextForRead: %v", err)
	}

	t.Run("filters by specific assignee", func(t *testing.T) {
		_, _, _, cols, err := st.GetBoard(ctxOwner, &pc, "", "", strconv.FormatInt(u1.ID, 10), SprintFilter{Mode: "none"})
		if err != nil {
			t.Fatalf("GetBoard: %v", err)
		}
		todos := cols[DefaultColumnBacklog]
		if len(todos) != 1 || todos[0].Title != "Assigned to u1" {
			t.Fatalf("expected only 'Assigned to u1', got %+v", todos)
		}
	})

	t.Run("filters unassigned", func(t *testing.T) {
		_, _, _, cols, err := st.GetBoard(ctxOwner, &pc, "", "", "unassigned", SprintFilter{Mode: "none"})
		if err != nil {
			t.Fatalf("GetBoard: %v", err)
		}
		todos := cols[DefaultColumnBacklog]
		if len(todos) != 1 || todos[0].Title != "Unassigned" {
			t.Fatalf("expected only 'Unassigned', got %+v", todos)
		}
	})

	t.Run("no filter returns all", func(t *testing.T) {
		_, _, _, cols, err := st.GetBoard(ctxOwner, &pc, "", "", "", SprintFilter{Mode: "none"})
		if err != nil {
			t.Fatalf("GetBoard: %v", err)
		}
		if len(cols[DefaultColumnBacklog]) != 3 {
			t.Fatalf("expected 3 todos, got %d", len(cols[DefaultColumnBacklog]))
		}
	})
}

func TestListTodosForBoardLane_AssigneeFilter(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	owner, err := st.BootstrapUser(ctx, "assignee-filter-lane-owner@example.com", "password", "Owner")
	if err != nil {
		t.Fatalf("BootstrapUser: %v", err)
	}
	ctxOwner := WithUserID(ctx, owner.ID)

	p, err := st.CreateProject(ctxOwner, "p")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	u1, err := st.CreateUser(ctx, "assignee-filter-lane-u1@example.com", "password", "U1")
	if err != nil {
		t.Fatalf("CreateUser u1: %v", err)
	}
	if err := st.AddProjectMember(ctxOwner, owner.ID, p.ID, u1.ID, RoleMaintainer); err != nil {
		t.Fatalf("AddProjectMember u1: %v", err)
	}

	if _, err := st.CreateTodo(ctxOwner, p.ID, CreateTodoInput{Title: "Mine", AssigneeUserID: ptrInt64(u1.ID)}, ModeFull); err != nil {
		t.Fatalf("CreateTodo mine: %v", err)
	}
	if _, err := st.CreateTodo(ctxOwner, p.ID, CreateTodoInput{Title: "Not mine"}, ModeFull); err != nil {
		t.Fatalf("CreateTodo not mine: %v", err)
	}

	items, _, _, err := st.ListTodosForBoardLane(ctxOwner, p.ID, DefaultColumnBacklog, 20, 0, 0, "", "", strconv.FormatInt(u1.ID, 10), SprintFilter{Mode: "none"})
	if err != nil {
		t.Fatalf("ListTodosForBoardLane: %v", err)
	}
	if len(items) != 1 || items[0].Title != "Mine" {
		t.Fatalf("expected only 'Mine', got %+v", items)
	}

	count, err := st.CountTodosForBoardLane(ctxOwner, p.ID, DefaultColumnBacklog, "", "", "unassigned", SprintFilter{Mode: "none"})
	if err != nil {
		t.Fatalf("CountTodosForBoardLane: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 unassigned todo, got %d", count)
	}
}
