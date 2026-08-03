import { buildRowTree } from "./rowTree";

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

  it("treats a row whose parent is not loaded as top level", () => {
    const rows = [row("a"), row("orphan", "missing")];
    const tree = buildRowTree(rows, new Set());

    expect(tree.visibleRows.map((item) => item.id)).toEqual(["a", "orphan"]);
    expect(tree.hasNesting).toBe(false);
  });
});
