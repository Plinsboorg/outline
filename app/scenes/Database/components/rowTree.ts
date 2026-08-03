type RowLike = { id: string; parentDocumentId?: string | null };

export type RowTree<T extends RowLike> = {
  /** The rows to display, in order: children follow their expanded parent. */
  visibleRows: T[];
  /** Indent depth by row id; rows without an entry are top level. */
  depthById: Map<string, number>;
  /** Ids of rows that have at least one child row loaded. */
  parentIds: Set<string>;
  /** Whether any loaded row nests under another. */
  hasNesting: boolean;
};

/**
 * Arranges a flat list of rows into display order for views that show
 * sub-items: children are listed directly under their parent, indented one
 * level, and only while the parent is expanded. A row whose parent is not in
 * the list — filtered out, or on a page that has not been loaded — is shown
 * at the top level, so no row is ever silently hidden.
 *
 * @param rows the loaded rows, in fetch order.
 * @param expandedIds the ids of rows whose children are shown.
 * @returns the display order plus depth and parent lookups.
 */
export function buildRowTree<T extends RowLike>(
  rows: T[],
  expandedIds: ReadonlySet<string>
): RowTree<T> {
  const ids = new Set(rows.map((row) => row.id));
  const childrenByParent = new Map<string, T[]>();
  const topLevel: T[] = [];

  for (const row of rows) {
    const parentId = row.parentDocumentId;
    if (parentId && ids.has(parentId) && parentId !== row.id) {
      const siblings = childrenByParent.get(parentId);
      if (siblings) {
        siblings.push(row);
      } else {
        childrenByParent.set(parentId, [row]);
      }
    } else {
      topLevel.push(row);
    }
  }

  const visibleRows: T[] = [];
  const depthById = new Map<string, number>();

  const walk = (list: T[], depth: number) => {
    for (const row of list) {
      visibleRows.push(row);
      if (depth > 0) {
        depthById.set(row.id, depth);
      }
      const children = childrenByParent.get(row.id);
      if (children && expandedIds.has(row.id)) {
        walk(children, depth + 1);
      }
    }
  };
  walk(topLevel, 0);

  return {
    visibleRows,
    depthById,
    parentIds: new Set(childrenByParent.keys()),
    hasNesting: childrenByParent.size > 0,
  };
}
