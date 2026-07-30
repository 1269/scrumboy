package mcp

import (
	"context"
	"net/http"
	"testing"

	"scrumboy/internal/store"
)

func TestBoardGetContract_DurableReadOmitsActivityRefresh(t *testing.T) {
	h := newBoardGetContractHarness(t)

	_, _, err := h.call(map[string]any{"projectSlug": h.Project.Slug})
	if err != nil {
		t.Fatalf("board_get: %v", err)
	}
	if len(h.Recording.callsFor("activity")) != 0 {
		t.Fatalf("durable read activity calls = %#v", h.Recording.callsFor("activity"))
	}
}

func TestBoardGetContract_ExpiringReadRefreshesActivityLast(t *testing.T) {
	h := newBoardGetContractHarness(t)
	project, err := h.Store.CreateAnonymousBoard(store.WithUserID(context.Background(), h.Owner.ID))
	if err != nil {
		t.Fatalf("create temporary board: %v", err)
	}

	_, _, readErr := h.call(map[string]any{"projectSlug": project.Slug})
	if readErr != nil {
		t.Fatalf("board_get: %v", readErr)
	}

	activity := h.Recording.callsFor("activity")
	if len(activity) != 1 {
		t.Fatalf("activity calls = %#v, want one", activity)
	}
	if activity[0].ProjectID != project.ID || activity[0].Context != h.Context {
		t.Fatalf("activity call = %#v, want project=%d exact request context", activity[0], project.ID)
	}
	if got := h.Recording.Calls[len(h.Recording.Calls)-1].Operation; got != "activity" {
		t.Fatalf("last operation = %q, want activity (all=%v)", got, h.Recording.operationNames())
	}
	workflow := h.Recording.callsFor("workflow")
	if len(workflow) != 1 {
		t.Fatalf("workflow calls = %#v", workflow)
	}
	if got, want := len(h.Recording.callsFor("list")), 5; got != want {
		t.Fatalf("list calls = %d, want %d for default temporary workflow", got, want)
	}
	if got, want := len(h.Recording.callsFor("count")), 5; got != want {
		t.Fatalf("count calls = %d, want %d for default temporary workflow", got, want)
	}
}

func TestBoardGetContract_PriorFailurePreventsActivityRefresh(t *testing.T) {
	h := newBoardGetContractHarness(t)
	project, err := h.Store.CreateAnonymousBoard(store.WithUserID(context.Background(), h.Owner.ID))
	if err != nil {
		t.Fatalf("create temporary board: %v", err)
	}
	h.Recording.Errors["count:"+store.DefaultColumnBacklog] = injectedBoardGetError("lane count")

	_, _, readErr := h.call(map[string]any{"projectSlug": project.Slug})

	requireBoardGetError(t, readErr, http.StatusInternalServerError, CodeInternal, "internal error", map[string]any{
		"detail": "phase 7 injected lane count failure",
	})
	if len(h.Recording.callsFor("activity")) != 0 {
		t.Fatalf("activity occurred after prior failure: %v", h.Recording.operationNames())
	}
}

func TestBoardGetContract_ActivityFailureIsFatalAndDiscardsProjection(t *testing.T) {
	h := newBoardGetContractHarness(t)
	project, err := h.Store.CreateAnonymousBoard(store.WithUserID(context.Background(), h.Owner.ID))
	if err != nil {
		t.Fatalf("create temporary board: %v", err)
	}
	h.Recording.Errors["activity"] = injectedBoardGetError("activity")

	data, meta, readErr := h.call(map[string]any{"projectSlug": project.Slug})

	requireBoardGetError(t, readErr, http.StatusInternalServerError, CodeInternal, "internal error", map[string]any{
		"detail": "phase 7 injected activity failure",
	})
	if data != nil || meta != nil {
		t.Fatalf("activity failure returned partial result: data=%#v meta=%#v", data, meta)
	}
	if got := h.Recording.Calls[len(h.Recording.Calls)-1].Operation; got != "activity" {
		t.Fatalf("last operation = %q, want activity (all=%v)", got, h.Recording.operationNames())
	}
}
