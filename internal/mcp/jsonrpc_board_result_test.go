package mcp

import (
	"reflect"
	"testing"
)

func TestJSONRPCBoardGetResultComposition(t *testing.T) {
	data := map[string]any{
		"project": map[string]any{"projectSlug": "phase-nine"},
		"columns": []any{},
	}
	meta := map[string]any{
		"nextCursorByColumn": map[string]any{"backlog": "opaque"},
		"hasMoreByColumn":    map[string]bool{"backlog": true},
		"totalCountByColumn": map[string]int{"backlog": 3},
		"unrelated":          "must not leak",
	}

	got := jsonRPCToolStructuredContent("board_get", data, meta)

	want := map[string]any{
		"project":            map[string]any{"projectSlug": "phase-nine"},
		"columns":            []any{},
		"nextCursorByColumn": map[string]any{"backlog": "opaque"},
		"hasMoreByColumn":    map[string]bool{"backlog": true},
		"totalCountByColumn": map[string]int{"backlog": 3},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("structured content = %#v, want %#v", got, want)
	}
	if _, ok := data["nextCursorByColumn"]; ok {
		t.Fatalf("source data was mutated: %#v", data)
	}
	gotMap, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("board result type = %T, want map[string]any", got)
	}
	gotMap["cloneProbe"] = true
	if _, exists := data["cloneProbe"]; exists {
		t.Fatalf("board result was not cloned: source=%#v", data)
	}
	if len(meta) != 4 || meta["unrelated"] != "must not leak" {
		t.Fatalf("source metadata was mutated: %#v", meta)
	}
}

func TestJSONRPCBoardGetResultCompositionSupportsDottedAlias(t *testing.T) {
	data := map[string]any{"project": "kept", "columns": "kept"}
	meta := map[string]any{
		"nextCursorByColumn": "next",
		"hasMoreByColumn":    "more",
		"totalCountByColumn": "total",
	}

	got := jsonRPCToolStructuredContent("board.get", data, meta)

	want := map[string]any{
		"project":            "kept",
		"columns":            "kept",
		"nextCursorByColumn": "next",
		"hasMoreByColumn":    "more",
		"totalCountByColumn": "total",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("alias structured content = %#v, want %#v", got, want)
	}
}

func TestJSONRPCBoardGetResultCompositionLeavesOtherToolsUnchanged(t *testing.T) {
	data := map[string]any{"items": []any{"kept"}}
	meta := map[string]any{"nextCursor": "currently discarded", "hasMore": true}

	got := jsonRPCToolStructuredContent("dashboard_listTodos", data, meta)

	if !reflect.DeepEqual(got, data) {
		t.Fatalf("unrelated tool data changed: got=%#v want=%#v", got, data)
	}
	got.(map[string]any)["identityProbe"] = true
	if data["identityProbe"] != true {
		t.Fatal("unrelated tool data should be returned without cloning or composition")
	}
}

func TestJSONRPCBoardGetResultCompositionHandlesMissingOrUnexpectedData(t *testing.T) {
	t.Run("nil metadata clones data without additions", func(t *testing.T) {
		data := map[string]any{"project": "kept", "columns": "kept"}

		got := jsonRPCToolStructuredContent("board_get", data, nil)

		if !reflect.DeepEqual(got, data) {
			t.Fatalf("nil metadata result = %#v, want %#v", got, data)
		}
		got.(map[string]any)["cloneProbe"] = true
		if _, exists := data["cloneProbe"]; exists {
			t.Fatal("board data should still be cloned")
		}
	})

	t.Run("unexpected board data type is preserved", func(t *testing.T) {
		data := []any{"unexpected"}

		got := jsonRPCToolStructuredContent("board_get", data, map[string]any{
			"nextCursorByColumn": "not merged",
		})

		if !reflect.DeepEqual(got, data) {
			t.Fatalf("unexpected data result = %#v, want %#v", got, data)
		}
	})
}
