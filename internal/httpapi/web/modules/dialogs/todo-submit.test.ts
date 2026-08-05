import { describe, expect, it } from "vitest";
import { buildTodoCreatePayload, buildTodoPatchPayload } from "./todo-submit.js";

describe("todo submit payload helpers", () => {
  it("preserves raw markdown in create payloads", () => {
    const body = "# Heading\n\n- item\n\n`code`";
    const payload = buildTodoCreatePayload({
      title: "Plain title",
      body,
      tags: ["Bug"],
      columnKey: "backlog",
      estimationRaw: "5",
      sprintEnabled: true,
      sprintId: 12,
      assigneeEnabled: true,
      assigneeUserId: 44,
    });

    expect(payload).toEqual({
      title: "Plain title",
      body,
      tags: ["Bug"],
      columnKey: "backlog",
      estimationPoints: 5,
      sprintId: 12,
      assigneeUserId: 44,
      priorityKey: null,
    });
  });

  it("preserves raw markdown in patch payloads without converting to html", () => {
    const body = "## Notes\n\n**still markdown**";
    const payload = buildTodoPatchPayload({
      title: "**plain title**",
      body,
      tags: [],
      estimationRaw: "invalid",
      assigneeEnabled: true,
      assigneeUserId: null,
      sprintEnabled: false,
      sprintId: 8,
    });

    expect(payload).toEqual({
      title: "**plain title**",
      body,
      tags: [],
      assigneeUserId: null,
      priorityKey: null,
    });
    expect(JSON.stringify(payload)).not.toContain("<h2>");
    expect(JSON.stringify(payload)).not.toContain("<strong>");
  });

  it("includes the selected priority key in create payloads", () => {
    const payload = buildTodoCreatePayload({
      title: "Title",
      body: "",
      tags: [],
      columnKey: "backlog",
      priorityKey: "urgent",
    });

    expect(payload.priorityKey).toBe("urgent");
  });

  it("normalizes an empty priority key to null", () => {
    const payload = buildTodoPatchPayload({
      title: "Title",
      body: "",
      tags: [],
      priorityKey: "",
    });

    expect(payload.priorityKey).toBeNull();
  });
});
