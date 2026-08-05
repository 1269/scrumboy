package store

import (
	"context"
	"errors"
	"testing"
)

func TestGetProjectPriorities_SeedsDefaults(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-defaults")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	tiers, err := st.GetProjectPriorities(ctx, project.ID)
	if err != nil {
		t.Fatalf("GetProjectPriorities: %v", err)
	}
	want := []string{"low", "medium", "high", "urgent"}
	if len(tiers) != len(want) {
		t.Fatalf("expected %d default tiers, got %d", len(want), len(tiers))
	}
	for i, tier := range tiers {
		if tier.Key != want[i] {
			t.Fatalf("tier %d: want key %q, got %q", i, want[i], tier.Key)
		}
		if tier.Position != i {
			t.Fatalf("tier %q: want position %d, got %d", tier.Key, i, tier.Position)
		}
	}
}

func TestAddPriorityTier_AppendsAtEnd(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-add")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	added, err := st.AddPriorityTier(ctx, project.ID, "Critical")
	if err != nil {
		t.Fatalf("AddPriorityTier: %v", err)
	}
	if added.Key != "critical" {
		t.Fatalf("expected generated key %q, got %q", "critical", added.Key)
	}
	if added.Position != 4 {
		t.Fatalf("expected new tier appended at position 4, got %d", added.Position)
	}

	tiers, err := st.GetProjectPriorities(ctx, project.ID)
	if err != nil {
		t.Fatalf("GetProjectPriorities: %v", err)
	}
	if len(tiers) != 5 {
		t.Fatalf("expected 5 tiers after add, got %d", len(tiers))
	}
	if tiers[4].Key != "critical" {
		t.Fatalf("expected last tier to be %q, got %q", "critical", tiers[4].Key)
	}
}

func TestAddPriorityTier_RejectsEmptyName(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-add-empty")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if _, err := st.AddPriorityTier(ctx, project.ID, "   "); !errors.Is(err, ErrValidation) {
		t.Fatalf("expected ErrValidation for empty name, got %v", err)
	}
}

func TestUpdatePriorityTier_ChangesNameAndColor(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-update")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if err := st.UpdatePriorityTier(ctx, project.ID, "low", "Chill", "#112233"); err != nil {
		t.Fatalf("UpdatePriorityTier: %v", err)
	}

	tiers, err := st.GetProjectPriorities(ctx, project.ID)
	if err != nil {
		t.Fatalf("GetProjectPriorities: %v", err)
	}
	if tiers[0].Name != "Chill" || tiers[0].Color != "#112233" {
		t.Fatalf("expected updated tier, got %+v", tiers[0])
	}
	if tiers[0].Key != "low" || tiers[0].Position != 0 {
		t.Fatalf("expected key/position unchanged, got %+v", tiers[0])
	}
}

func TestUpdatePriorityTier_RejectsInvalidColor(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-update-badcolor")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if err := st.UpdatePriorityTier(ctx, project.ID, "low", "Chill", "not-a-color"); !errors.Is(err, ErrValidation) {
		t.Fatalf("expected ErrValidation for invalid color, got %v", err)
	}
}

func TestUpdatePriorityTier_NotFound(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-update-missing")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if err := st.UpdatePriorityTier(ctx, project.ID, "does-not-exist", "Name", "#112233"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeletePriorityTier_ResequencesPositions(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-delete")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if err := st.DeletePriorityTier(ctx, project.ID, "medium"); err != nil {
		t.Fatalf("DeletePriorityTier: %v", err)
	}

	tiers, err := st.GetProjectPriorities(ctx, project.ID)
	if err != nil {
		t.Fatalf("GetProjectPriorities: %v", err)
	}
	want := []string{"low", "high", "urgent"}
	if len(tiers) != len(want) {
		t.Fatalf("expected %d tiers after delete, got %d", len(want), len(tiers))
	}
	for i, tier := range tiers {
		if tier.Key != want[i] {
			t.Fatalf("tier %d: want key %q, got %q", i, want[i], tier.Key)
		}
		if tier.Position != i {
			t.Fatalf("tier %q: want resequenced position %d, got %d", tier.Key, i, tier.Position)
		}
	}
}

func TestDeletePriorityTier_BlockedWhenInUse(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-delete-inuse")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	low := "low"
	if _, err := st.CreateTodo(ctx, project.ID, CreateTodoInput{Title: "t1", PriorityKey: &low}, ModeFull); err != nil {
		t.Fatalf("CreateTodo: %v", err)
	}

	if err := st.DeletePriorityTier(ctx, project.ID, "low"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict for in-use tier, got %v", err)
	}
}

func TestDeletePriorityTier_BlockedWhenLastTier(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-delete-last")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	for _, key := range []string{"medium", "high", "urgent"} {
		if err := st.DeletePriorityTier(ctx, project.ID, key); err != nil {
			t.Fatalf("DeletePriorityTier(%q): %v", key, err)
		}
	}

	if err := st.DeletePriorityTier(ctx, project.ID, "low"); !errors.Is(err, ErrValidation) {
		t.Fatalf("expected ErrValidation deleting the last remaining tier, got %v", err)
	}
}

func TestDeletePriorityTier_NotFound(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-delete-missing")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if err := st.DeletePriorityTier(ctx, project.ID, "does-not-exist"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestCreateTodo_ValidatesPriorityKey(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-todo-create")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	bogus := "not-a-real-tier"
	if _, err := st.CreateTodo(ctx, project.ID, CreateTodoInput{Title: "t1", PriorityKey: &bogus}, ModeFull); !errors.Is(err, ErrValidation) {
		t.Fatalf("expected ErrValidation for unknown priority key, got %v", err)
	}

	urgent := "urgent"
	todo, err := st.CreateTodo(ctx, project.ID, CreateTodoInput{Title: "t2", PriorityKey: &urgent}, ModeFull)
	if err != nil {
		t.Fatalf("CreateTodo with valid priority: %v", err)
	}
	if todo.PriorityKey == nil || *todo.PriorityKey != "urgent" {
		t.Fatalf("expected priority key %q, got %v", "urgent", todo.PriorityKey)
	}
}

func TestUpdateTodoByLocalID_ChangesPriorityKey(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-todo-update")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	todo, err := st.CreateTodo(ctx, project.ID, CreateTodoInput{Title: "t1"}, ModeFull)
	if err != nil {
		t.Fatalf("CreateTodo: %v", err)
	}
	if todo.PriorityKey != nil {
		t.Fatalf("expected no priority set on create, got %v", *todo.PriorityKey)
	}

	high := "high"
	updated, err := st.UpdateTodoByLocalID(ctx, project.ID, todo.LocalID, UpdateTodoInput{
		Title:       todo.Title,
		PriorityKey: &high,
	}, ModeFull)
	if err != nil {
		t.Fatalf("UpdateTodoByLocalID: %v", err)
	}
	if updated.PriorityKey == nil || *updated.PriorityKey != "high" {
		t.Fatalf("expected priority key %q, got %v", "high", updated.PriorityKey)
	}

	// Clearing priority (nil) should persist as unset.
	cleared, err := st.UpdateTodoByLocalID(ctx, project.ID, todo.LocalID, UpdateTodoInput{
		Title: todo.Title,
	}, ModeFull)
	if err != nil {
		t.Fatalf("UpdateTodoByLocalID (clear): %v", err)
	}
	if cleared.PriorityKey != nil {
		t.Fatalf("expected priority cleared, got %v", *cleared.PriorityKey)
	}

	// Reload from DB to confirm persistence, not just the in-memory struct.
	reloaded, err := st.GetTodoByLocalID(ctx, project.ID, todo.LocalID, ModeFull)
	if err != nil {
		t.Fatalf("GetTodoByLocalID: %v", err)
	}
	if reloaded.PriorityKey != nil {
		t.Fatalf("expected persisted priority cleared, got %v", *reloaded.PriorityKey)
	}
}

func TestUpdateTodo_ValidatesPriorityKey(t *testing.T) {
	st, cleanup := newTestStore(t)
	defer cleanup()

	ctx := context.Background()
	project, err := st.CreateProject(ctx, "priority-todo-update-invalid")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	todo, err := st.CreateTodo(ctx, project.ID, CreateTodoInput{Title: "t1"}, ModeFull)
	if err != nil {
		t.Fatalf("CreateTodo: %v", err)
	}

	bogus := "not-a-real-tier"
	if _, err := st.UpdateTodoByLocalID(ctx, project.ID, todo.LocalID, UpdateTodoInput{
		Title:       todo.Title,
		PriorityKey: &bogus,
	}, ModeFull); !errors.Is(err, ErrValidation) {
		t.Fatalf("expected ErrValidation for unknown priority key, got %v", err)
	}
}
