import fractionalIndex from "fractional-index";
import { orderBy } from "es-toolkit/compat";

type RowLike = { id: string; parentDocumentId?: string | null };

/** A row carrying the fields its manual arrangement is derived from. */
type OrderedRowLike = RowLike & {
  databaseIndex?: string | null;
  createdAt?: string;
};

/**
 * Sorts above every character a fractional index can hold, so rows that have
 * never been arranged by hand sort last rather than first.
 */
const UNORDERED = "\uffff";

/** The outcome of planning a row move; only "move" has anything to apply. */
export type RowMovePlan<T> =
  | {
      status: "move";
      /** The rows in their new order. */
      rows: T[];
      /** The parent the moved row now sits under; null means top level. */
      parentDocumentId: string | null;
      /** The fractional index placing the row among its new siblings. */
      index: string;
    }
  | { status: "none" }
  | { status: "cycle" };

export type RowTree<T extends RowLike> = {
  /** The rows to display, in order: children follow their expanded parent. */
  visibleRows: T[];
  /** Indent depth by row id; rows without an entry are top level. */
  depthById: Map<string, number>;
  /** Ids of rows that have at least one child row loaded. */
  parentIds: Set<string>;
  /**
   * The rows whose shown sub-item list ends after a given row, innermost
   * first — where an "add sub-item" affordance belongs at the foot of each
   * open list.
   */
  listEndsAfter: Map<string, T[]>;
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
  const listEndsAfter = new Map<string, T[]>();

  const walk = (list: T[], depth: number) => {
    for (const row of list) {
      visibleRows.push(row);
      if (depth > 0) {
        depthById.set(row.id, depth);
      }
      const children = childrenByParent.get(row.id);
      if (children && expandedIds.has(row.id)) {
        walk(children, depth + 1);
        // the last row walked closes this row's list; several lists can end
        // at once when the last child is an open parent itself
        const last = visibleRows[visibleRows.length - 1];
        const ends = listEndsAfter.get(last.id);
        if (ends) {
          ends.push(row);
        } else {
          listEndsAfter.set(last.id, [row]);
        }
      }
    }
  };
  walk(topLevel, 0);

  return {
    visibleRows,
    depthById,
    parentIds: new Set(childrenByParent.keys()),
    listEndsAfter,
    hasNesting: childrenByParent.size > 0,
  };
}

/**
 * Orders rows by the arrangement made by hand — the one the server lists a
 * database's rows in, and the one both the table and the sidebar show when no
 * sort is applied. Fractional indexes compare byte for byte, so the order here
 * matches the order a new index is computed against.
 *
 * @param rows the rows to order.
 * @returns a new array in manual order.
 */
export function orderRowsByIndex<T extends OrderedRowLike>(rows: T[]): T[] {
  return orderBy(
    rows,
    [(row) => row.databaseIndex ?? UNORDERED, "createdAt"],
    ["asc", "asc"]
  );
}

/**
 * Works out where a row lands when it is dropped beside another one: it
 * becomes that row's sibling, so a single drop can reorder within a level,
 * nest a row under a different parent, or pull a sub-item back out to the top
 * level. Shared by the table's row drag and the sidebar's, so both arrive at
 * the same arrangement.
 *
 * @param rows every loaded row, in manual order.
 * @param documentId the row being moved.
 * @param overDocumentId the row it was dropped beside.
 * @param placement whether the moved row takes the target's place, as when
 * dragging within the table, or follows it, as when dropping on the cursor
 * beneath a sidebar row.
 * @returns the move to apply, or why there is nothing to apply.
 * @throws when no fractional index exists between the new neighbours.
 */
export function planRowMove<T extends OrderedRowLike>(
  rows: T[],
  documentId: string,
  overDocumentId: string,
  placement: "over" | "after" = "over"
): RowMovePlan<T> {
  const from = rows.findIndex((row) => row.id === documentId);
  const over = rows.findIndex((row) => row.id === overDocumentId);
  if (from === -1 || over === -1 || from === over) {
    return { status: "none" };
  }
  // taking the target's place lands after it when the row comes from above and
  // before it when it comes from below; following the target is always after
  const to = placement === "after" && from > over ? over + 1 : over;

  const ids = new Set(rows.map((row) => row.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  // a row whose parent is not loaded is shown, and treated, as top level
  const effectiveParent = (row: T): string | null =>
    row.parentDocumentId && ids.has(row.parentDocumentId)
      ? row.parentDocumentId
      : null;
  const targetParentId = effectiveParent(
    placement === "after" ? rows[over] : rows[to]
  );

  // staying put is only a no-op while the row keeps its parent — the same
  // position under a different one is a change of nesting
  if (to === from && effectiveParent(rows[from]) === targetParentId) {
    return { status: "none" };
  }

  // nesting a row inside its own subtree would orphan the whole branch
  let ancestorId = targetParentId;
  while (ancestorId) {
    if (ancestorId === documentId) {
      return { status: "cycle" };
    }
    const ancestor = byId.get(ancestorId);
    ancestorId = ancestor ? effectiveParent(ancestor) : null;
  }

  const reordered = [...rows];
  reordered.splice(to, 0, ...reordered.splice(from, 1));

  // the nearest neighbours in the same sibling group decide the new index; a
  // neighbour without one has never been ordered and sorts last regardless, so
  // an unbounded index on that side is what we want
  let before: string | null = null;
  for (let i = to - 1; i >= 0; i--) {
    if (effectiveParent(reordered[i]) === targetParentId) {
      before = reordered[i].databaseIndex ?? null;
      break;
    }
  }
  let after: string | null = null;
  for (let i = to + 1; i < reordered.length; i++) {
    if (effectiveParent(reordered[i]) === targetParentId) {
      after = reordered[i].databaseIndex ?? null;
      break;
    }
  }

  return {
    status: "move",
    rows: reordered,
    parentDocumentId: targetParentId,
    index: fractionalIndex(before, after),
  };
}
