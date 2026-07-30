package mcp

import (
	"context"
	"net/http"
	"testing"

	"scrumboy/internal/store"
)

func TestBoardGetContract_ValidationBeforeAccess(t *testing.T) {
	tests := []struct {
		name    string
		input   any
		message string
		details map[string]any
	}{
		{
			name:    "assignee JSON number is rejected by the type guard",
			input:   map[string]any{"projectSlug": "unused", "assignee": 42},
			message: "invalid assignee",
			details: map[string]any{"field": "assignee"},
		},
		{
			name:    "assignee JSON null is rejected by the type guard",
			input:   map[string]any{"projectSlug": "unused", "assignee": nil},
			message: "invalid assignee",
			details: map[string]any{"field": "assignee"},
		},
		{
			name:    "missing project slug",
			input:   map[string]any{},
			message: "missing projectSlug",
			details: map[string]any{"field": "projectSlug"},
		},
		{
			name:    "empty project slug",
			input:   map[string]any{"projectSlug": ""},
			message: "missing projectSlug",
			details: map[string]any{"field": "projectSlug"},
		},
		{
			name:    "negative limit",
			input:   map[string]any{"projectSlug": "unused", "limit": -1},
			message: "invalid limit",
			details: map[string]any{"field": "limit"},
		},
		{
			name:    "limit above maximum",
			input:   map[string]any{"projectSlug": "unused", "limit": 101},
			message: "invalid limit",
			details: map[string]any{"field": "limit"},
		},
		{
			name:    "invalid assignee string",
			input:   map[string]any{"projectSlug": "unused", "assignee": "somebody"},
			message: "invalid assignee",
			details: map[string]any{"field": "assignee"},
		},
		{
			name:    "invalid sort",
			input:   map[string]any{"projectSlug": "unused", "sort": "rank-desc"},
			message: "invalid sort",
			details: map[string]any{"field": "sort"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newBoardGetContractHarness(t)

			_, _, err := h.call(tt.input)

			requireBoardGetError(t, err, http.StatusBadRequest, CodeValidationError, tt.message, tt.details)
			requireOperationNames(t, h.Recording, "countUsers")
		})
	}
}

func TestBoardGetContract_MalformedInputShape(t *testing.T) {
	h := newBoardGetContractHarness(t)

	_, _, err := h.call("not an input object")

	if err == nil || err.Status != http.StatusBadRequest || err.Code != CodeValidationError || err.Message != "invalid input" {
		t.Fatalf("malformed input error = %#v", err)
	}
	details, ok := err.Details.(map[string]any)
	if !ok || details["detail"] == "" {
		t.Fatalf("malformed input details = %#v, want non-empty detail", err.Details)
	}
	requireOperationNames(t, h.Recording, "countUsers")
}

func TestBoardGetContract_AccessPrecedesSprintAndCursorValidation(t *testing.T) {
	tests := []struct {
		name  string
		input func(slug string) map[string]any
	}{
		{
			name: "invalid sprint is masked for denied project",
			input: func(slug string) map[string]any {
				return map[string]any{"projectSlug": slug, "sprintId": -1}
			},
		},
		{
			name: "malformed cursor is masked for denied project",
			input: func(slug string) map[string]any {
				return map[string]any{
					"projectSlug": slug,
					"cursorByColumn": map[string]any{
						"triage": "not-base64!",
					},
				}
			},
		},
		{
			name: "unknown cursor column is masked for denied project",
			input: func(slug string) map[string]any {
				return map[string]any{
					"projectSlug": slug,
					"cursorByColumn": map[string]any{
						"unknown": encodeBoardCursor("1:1"),
					},
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newBoardGetContractHarness(t)
			h.Context = store.WithUserID(context.Background(), h.Other.ID)

			_, _, err := h.call(tt.input(h.Project.Slug))

			requireBoardGetError(t, err, http.StatusNotFound, CodeNotFound, "not found", map[string]any{})
			requireOperationNames(t, h.Recording, "countUsers", "access")
		})
	}
}

func TestBoardGetContract_CursorKeyValidationFollowsWorkflow(t *testing.T) {
	h := newBoardGetContractHarness(t)

	_, _, err := h.call(map[string]any{
		"projectSlug": h.Project.Slug,
		"cursorByColumn": map[string]any{
			"not-a-workflow-column": encodeBoardCursor("1:1"),
		},
	})

	requireBoardGetError(t, err, http.StatusBadRequest, CodeValidationError, "invalid column cursor", map[string]any{
		"field":     "cursorByColumn",
		"columnKey": "not-a-workflow-column",
	})
	requireOperationNames(t, h.Recording, "countUsers", "access", "workflow")
}

func TestBoardGetContract_MalformedLaterCursorPreservesPartialReadBoundary(t *testing.T) {
	h := newBoardGetContractHarness(t)

	_, _, err := h.call(map[string]any{
		"projectSlug": h.Project.Slug,
		"cursorByColumn": map[string]any{
			"building": "not-base64!",
		},
	})

	requireBoardGetError(t, err, http.StatusBadRequest, CodeValidationError, "invalid board cursor", map[string]any{
		"field":     "cursorByColumn",
		"columnKey": "building",
	})
	requireOperationNames(t, h.Recording, "countUsers", "access", "workflow", "list", "count")
	firstList := h.Recording.callsFor("list")[0]
	if firstList.ColumnKey != "triage" {
		t.Fatalf("first processed column = %q, want triage", firstList.ColumnKey)
	}
}

func TestBoardGetContract_NonEmptyInvalidAndMissingSlugContracts(t *testing.T) {
	h := newBoardGetContractHarness(t)

	tests := []struct {
		slug    string
		status  int
		code    string
		message string
	}{
		{slug: "not valid !!!", status: http.StatusBadRequest, code: CodeValidationError, message: "validation: invalid slug"},
		{slug: "missing-phase-7-board", status: http.StatusNotFound, code: CodeNotFound, message: "not found"},
	}
	for _, tt := range tests {
		_, _, err := h.call(map[string]any{"projectSlug": tt.slug})

		requireBoardGetError(t, err, tt.status, tt.code, tt.message, map[string]any{})
		requireOperationNames(t, h.Recording, "countUsers", "access")
		if got := h.Recording.callsFor("access")[0].Slug; got != tt.slug {
			t.Fatalf("access slug = %q, want exact input %q", got, tt.slug)
		}
	}
}
