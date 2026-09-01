import { buildRowTree, orderRowsByIndex, planRowMove } from "./rowTree";

const row = (id: string, parentDocumentId: string | null = null) => ({
  id,
  parentDocumentId,
});

describe("buildRowTree", () => {
  it("keeps a flat list unchanged", () => {
    const rows = [row("a"), row("b")];
    const tree = buildRowTree(rows, new Set());

    expect(tree.visibleRows.map((item) => item.id)).toEqual(["a", "b"]);
    expect(tree.hasNesting).toBe(false);
    expect(tree.parentIds.size).toBe(0);
    expect(tree.depthById.size).toBe(0);
  });

  it("hides children of a collapsed parent", () => {
    const rows = [row("a"), row("a1", "a"), row("b")];
    const tree = buildRowTree(rows, new Set());

    expect(tree.visibleRows.map((item) => item.id)).toEqual(["a", "b"]);
    expect(tree.hasNesting).toBe(true);
    expect(tree.parentIds.has("a")).toBe(true);
  });

  it("lists children under their expanded parent, indented", () => {
    const rows = [row("a"), row("b"), row("a1", "a"), row("a2", "a")];
    const tree = buildRowTree(rows, new Set(["a"]));

    expect(tree.visibleRows.map((item) => item.id)).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
    expect(tree.depthById.get("a1")).toBe(1);
    expect(tree.depthById.get("a")).toBeUndefined();
  });

  it("nests recursively while every level is expanded", () => {
    const rows = [row("a"), row("a1", "a"), row("a1x", "a1")];

    const collapsedInner = buildRowTree(rows, new Set(["a"]));
    expect(collapsedInner.visibleRows.map((item) => item.id)).toEqual([
      "a",
      "a1",
    ]);

    const expanded = buildRowTree(rows, new Set(["a", "a1"]));
    expect(expanded.visibleRows.map((item) => item.id)).toEqual([
      "a",
      "a1",
      "a1x",
    ]);
    expect(expanded.depthById.get("a1x")).toBe(2);
  });

  it("marks where each open sub-item list ends", () => {
    const rows = [row("a"), row("a1", "a"), row("a1x", "a1"), row("b")];

    const collapsed = buildRowTree(rows, new Set());
    expect(collapsed.listEndsAfter.size).toBe(0);

    // one list ends after the last child of the only open parent
    const outer = buildRowTree(rows, new Set(["a"]));
    expect([...outer.listEndsAfter.keys()]).toEqual(["a1"]);
    expect(outer.listEndsAfter.get("a1")?.map((item) => item.id)).toEqual([
      "a",
    ]);

    // both lists end after the same row when the last child is open itself,
    // innermost first
    const nested = buildRowTree(rows, new Set(["a", "a1"]));
    expect(nested.listEndsAfter.get("a1x")?.map((item) => item.id)).toEqual([
      "a1",
      "a",
    ]);
  });

  it("treats a row whose parent is not loaded as top level", () => {
    const rows = [row("a"), row("orphan", "missing")];
    const tree = buildRowTree(rows, new Set());

    expect(tree.visibleRows.map((item) => item.id)).toEqual(["a", "orphan"]);
    expect(tree.hasNesting).toBe(false);
  });
});

const ordered = (
  id: string,
  databaseIndex: string | null,
  parentDocumentId: string | null = null,
  createdAt = "2026-01-01T00:00:00.000Z"
) => ({ id, parentDocumentId, databaseIndex, createdAt });

describe("orderRowsByIndex", () => {
  it("orders by fractional index, unordered rows last and oldest first", () => {
    const rows = [
      ordered("c", null, null, "2026-01-03T00:00:00.000Z"),
      ordered("b", "a1"),
      ordered("d", null, null, "2026-01-02T00:00:00.000Z"),
      ordered("a", "a0"),
    ];

    expect(orderRowsByIndex(rows).map((item) => item.id)).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });
});

describe("planRowMove", () => {
  it("reorders within a level and returns an index between the neighbours", () => {
    const rows = [ordered("a", "a0"), ordered("b", "a1"), ordered("c", "a2")];
    const plan = planRowMove(rows, "c", "a");

    expect(plan.status).toBe("move");
    if (plan.status !== "move") {
      return;
    }
    expect(plan.parentDocumentId).toBeNull();
    expect(plan.rows.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(plan.index < "a0").toBe(true);
  });

  it("places the row after its target when following it", () => {
    const rows = [ordered("a", "a0"), ordered("b", "a1"), ordered("c", "a2")];
    const plan = planRowMove(rows, "c", "a", "after");

    expect(plan.status).toBe("move");
    if (plan.status !== "move") {
      return;
    }
    expect(plan.rows.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(plan.index > "a0" && plan.index < "a1").toBe(true);
  });

  it("adopts the parent of the row it is dropped beside", () => {
    const rows = [
      ordered("a", "a0"),
      ordered("a1", "a0", "a"),
      ordered("b", "a1"),
    ];
    const plan = planRowMove(rows, "b", "a1", "after");

    expect(plan.status).toBe("move");
    if (plan.status !== "move") {
      return;
    }
    expect(plan.parentDocumentId).toBe("a");
  });

  it("refuses to nest a row under its own sub-item", () => {
    const rows = [ordered("a", "a0"), ordered("a1", "a1", "a")];

    expect(planRowMove(rows, "a", "a1", "after").status).toBe("cycle");
  });

  it("has nothing to do when the row is dropped where it already is", () => {
    const rows = [ordered("a", "a0"), ordered("b", "a1")];

    expect(planRowMove(rows, "a", "a", "after").status).toBe("none");
    // b already follows a at the same level
    expect(planRowMove(rows, "b", "a", "after").status).toBe("none");
    expect(planRowMove(rows, "unknown", "a").status).toBe("none");
  });
});
