import type {
  DataView,
  DataViewColumn,
  DataViewColumnOverride,
  DataViewOverride,
  DataViewSort,
  FilterCondition,
  FilterGroup,
  PropertyValue,
} from "../types";
import { FilterOperator, SummaryAggregation } from "../types";
import { TITLE_COLUMN_ID } from "./properties";

/** How deeply a filter group parsed from untrusted input may nest. */
const MAX_FILTER_DEPTH = 5;

/**
 * Applies an override to a saved view, returning the view as it should be
 * rendered where that override is in force.
 *
 * The returned view's `filter` holds the override's OWN filter, not the saved
 * view's: where an override applies, the saved view's filter is not editable
 * and narrows the query from underneath (pass it separately as the base
 * filter, see `baseFilterForOverride`). Every other field falls back to the
 * saved view, so a field the override says nothing about keeps following it.
 *
 * @param view the saved view to render.
 * @param override the override to apply, if any.
 * @returns the view to render.
 */
export function applyViewOverride(
  view: DataView,
  override?: DataViewOverride | null
): DataView {
  if (!override || isEmptyOverride(override)) {
    return view;
  }

  return {
    ...view,
    columns: overriddenColumns(view.columns, override),
    sorts: override.sorts ?? view.sorts,
    filter: override.filter ?? undefined,
    groupBy:
      override.groupBy === undefined
        ? view.groupBy
        : (override.groupBy ?? undefined),
  };
}

/**
 * The filter a saved view contributes to the query when an override is in
 * force: the view's own, which the override can narrow but not remove.
 *
 * @param view the saved view being rendered.
 * @param override the override in force, if any.
 * @returns the filter to apply beneath the override's own.
 */
export function baseFilterForOverride(
  view: DataView,
  override?: DataViewOverride | null
): FilterGroup | undefined {
  return override && !isEmptyOverride(override) ? view.filter : undefined;
}

/**
 * Folds an edit made where an override is in force into that override, so
 * only what actually differs from the saved view is stored. An edit that
 * returns a setting to the view's own value drops it from the override,
 * handing the column or field back to the view.
 *
 * @param view the saved view the override applies to.
 * @param override the override as it stands.
 * @param attrs the edit, expressed as it would be against a view.
 * @returns the override to store.
 */
export function mergeIntoOverride(
  view: DataView,
  override: DataViewOverride,
  attrs: Partial<DataView>
): DataViewOverride {
  const next: DataViewOverride = { ...override };

  if ("columns" in attrs) {
    const columns = attrs.columns ?? [];
    const diffed = columns
      .map((column) => diffColumn(view.columns, column))
      .filter((column): column is DataViewColumnOverride => !!column);
    if (diffed.length) {
      next.columns = diffed;
    } else {
      delete next.columns;
    }

    const order = columns.map((column) => column.propertyId);
    if (sameOrder(order, baseOrder(view.columns, order))) {
      delete next.columnOrder;
    } else {
      next.columnOrder = order;
    }
  }

  if ("sorts" in attrs) {
    const sorts = attrs.sorts ?? [];
    if (sameSorts(sorts, view.sorts ?? [])) {
      delete next.sorts;
    } else {
      next.sorts = sorts;
    }
  }

  if ("filter" in attrs) {
    // the override's filter is its own condition set rather than a changed
    // copy of the view's, so there is nothing to compare it against
    if (attrs.filter?.conditions.length) {
      next.filter = attrs.filter;
    } else {
      delete next.filter;
    }
  }

  if ("groupBy" in attrs) {
    if (attrs.groupBy === view.groupBy) {
      delete next.groupBy;
    } else {
      next.groupBy = attrs.groupBy ?? null;
    }
  }

  return next;
}

/** Whether an override changes nothing about the view it applies to. */
export function isEmptyOverride(override?: DataViewOverride | null): boolean {
  if (!override) {
    return true;
  }
  return (
    !override.columns?.length &&
    !override.columnOrder?.length &&
    override.sorts === undefined &&
    !override.filter &&
    override.groupBy === undefined
  );
}

/**
 * Serializes an override for a URL query parameter.
 *
 * @param override the override to serialize.
 * @returns the serialized override, or undefined when it changes nothing.
 */
export function serializeViewOverride(
  override?: DataViewOverride | null
): string | undefined {
  return isEmptyOverride(override) ? undefined : JSON.stringify(override);
}

/**
 * Reads a serialized override, which arrives as untrusted document content —
 * anything unrecognizable is dropped rather than carried into a query. An
 * override's filter reaches the row query, so it is validated the same way a
 * saved view's is.
 *
 * @param value the serialized override.
 * @returns the override, or null when there is nothing valid in it.
 */
export function parseViewOverride(
  value: string | null | undefined
): DataViewOverride | null {
  if (!value) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (_err) {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const override: DataViewOverride = {};

  if (Array.isArray(parsed.columns)) {
    const columns = parsed.columns
      .map(parseColumnOverride)
      .filter((column): column is DataViewColumnOverride => !!column);
    if (columns.length) {
      override.columns = columns;
    }
  }
  if (Array.isArray(parsed.columnOrder)) {
    const order = parsed.columnOrder.filter(
      (id): id is string => typeof id === "string" && !!id
    );
    if (order.length) {
      override.columnOrder = order;
    }
  }
  if (Array.isArray(parsed.sorts)) {
    override.sorts = parsed.sorts
      .map(parseSort)
      .filter((sort): sort is DataViewSort => !!sort);
  }
  const filter = parseFilterGroup(parsed.filter, 1);
  if (filter) {
    override.filter = filter;
  }
  if (typeof parsed.groupBy === "string" && parsed.groupBy) {
    override.groupBy = parsed.groupBy;
  } else if (parsed.groupBy === null) {
    override.groupBy = null;
  }

  return isEmptyOverride(override) ? null : override;
}

/**
 * Builds an override from the separate per-embed settings database blocks
 * carried before they were one override, so blocks written by an older
 * version keep rendering the same way.
 *
 * @param legacy the block's former attributes.
 * @returns the equivalent override, or null when none of them were set.
 */
export function overrideFromLegacySettings(legacy: {
  hiddenProperties?: readonly string[] | null;
  filter?: FilterCondition | null;
  columnWidths?: Record<string, number> | null;
  wrappedColumns?: Record<string, boolean> | null;
}): DataViewOverride | null {
  const columns = new Map<string, DataViewColumnOverride>();
  const columnFor = (propertyId: string) => {
    const existing = columns.get(propertyId) ?? { propertyId };
    columns.set(propertyId, existing);
    return existing;
  };

  for (const propertyId of legacy.hiddenProperties ?? []) {
    columnFor(propertyId).visible = false;
  }
  for (const [propertyId, width] of Object.entries(legacy.columnWidths ?? {})) {
    columnFor(propertyId).width = width;
  }
  for (const [propertyId, wrap] of Object.entries(
    legacy.wrappedColumns ?? {}
  )) {
    columnFor(propertyId).wrap = wrap;
  }

  const override: DataViewOverride = {};
  if (columns.size) {
    override.columns = Array.from(columns.values());
  }
  if (legacy.filter) {
    override.filter = { conjunction: "and", conditions: [legacy.filter] };
  }
  return isEmptyOverride(override) ? null : override;
}

/** Patches and reorders a view's columns with those of an override. */
function overriddenColumns(
  columns: DataViewColumn[],
  override: DataViewOverride
): DataViewColumn[] {
  const patches = new Map(
    (override.columns ?? []).map((column) => [column.propertyId, column])
  );
  const patched: DataViewColumn[] = columns.map((column) => {
    const patch = patches.get(column.propertyId);
    if (!patch) {
      return column;
    }
    return {
      ...column,
      ...(patch.visible === undefined ? {} : { visible: patch.visible }),
      ...(patch.width === undefined ? {} : { width: patch.width }),
      ...(patch.wrap === undefined ? {} : { wrap: patch.wrap }),
      ...(patch.summary === undefined
        ? {}
        : { summary: patch.summary ?? undefined }),
    };
  });

  // a column the view does not list yet — the override was written against a
  // schema this view has since fallen behind, or the view never listed the
  // title column — is appended so the override's settings and order still
  // apply to it
  const missing = (propertyId: string) =>
    !patched.some((column) => column.propertyId === propertyId);

  for (const patch of patches.values()) {
    if (missing(patch.propertyId)) {
      patched.push({
        propertyId: patch.propertyId,
        visible: patch.visible ?? true,
        ...(patch.width === undefined ? {} : { width: patch.width }),
        ...(patch.wrap === undefined ? {} : { wrap: patch.wrap }),
        ...(patch.summary ? { summary: patch.summary } : {}),
      });
    }
  }
  for (const propertyId of override.columnOrder ?? []) {
    if (missing(propertyId)) {
      patched.push({ propertyId, visible: true });
    }
  }

  if (!override.columnOrder?.length) {
    return patched;
  }
  const rank = new Map(
    override.columnOrder.map((propertyId, index) => [propertyId, index])
  );
  // columns the order says nothing about keep their relative place at the end
  return patched
    .map((column, index) => ({ column, index }))
    .sort(
      (a, b) =>
        (rank.get(a.column.propertyId) ?? Infinity) -
          (rank.get(b.column.propertyId) ?? Infinity) || a.index - b.index
    )
    .map(({ column }) => column);
}

/** The settings of one column that differ from the view's own, if any. */
function diffColumn(
  columns: DataViewColumn[],
  column: DataViewColumn
): DataViewColumnOverride | undefined {
  const base = columns.find(
    (item) => item.propertyId === column.propertyId
  ) ?? {
    propertyId: column.propertyId,
    visible: true,
  };
  const diff: DataViewColumnOverride = { propertyId: column.propertyId };
  let changed = false;

  if (column.visible !== (base.visible ?? true)) {
    diff.visible = column.visible;
    changed = true;
  }
  if (column.width !== base.width) {
    diff.width = column.width;
    changed = true;
  }
  if (!!column.wrap !== !!base.wrap) {
    diff.wrap = !!column.wrap;
    changed = true;
  }
  if (column.summary !== base.summary) {
    diff.summary = column.summary ?? null;
    changed = true;
  }

  return changed ? diff : undefined;
}

/**
 * The order the view itself would put the given column ids in — its own
 * order, with the title column first and anything else it does not list
 * behind, exactly as `normalizedColumnsForView` arranges them.
 */
function baseOrder(columns: DataViewColumn[], ids: string[]): string[] {
  const rank = new Map(
    columns.map((column, index) => [column.propertyId, index])
  );
  if (!rank.has(TITLE_COLUMN_ID)) {
    rank.set(TITLE_COLUMN_ID, -1);
  }
  return ids
    .map((id, index) => ({ id, index }))
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
        a.index - b.index
    )
    .map(({ id }) => id);
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sameSorts(a: DataViewSort[], b: DataViewSort[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (sort, index) =>
        sort.propertyId === b[index].propertyId &&
        sort.direction === b[index].direction
    )
  );
}

function parseColumnOverride(value: unknown): DataViewColumnOverride | null {
  if (!isRecord(value) || typeof value.propertyId !== "string") {
    return null;
  }
  const column: DataViewColumnOverride = { propertyId: value.propertyId };
  if (typeof value.visible === "boolean") {
    column.visible = value.visible;
  }
  if (typeof value.width === "number" && value.width > 0) {
    column.width = Math.round(value.width);
  }
  if (typeof value.wrap === "boolean") {
    column.wrap = value.wrap;
  }
  if (
    typeof value.summary === "string" &&
    Object.values<string>(SummaryAggregation).includes(value.summary)
  ) {
    column.summary = value.summary as SummaryAggregation;
  } else if (value.summary === null) {
    column.summary = null;
  }
  return Object.keys(column).length > 1 ? column : null;
}

function parseSort(value: unknown): DataViewSort | null {
  if (
    !isRecord(value) ||
    typeof value.propertyId !== "string" ||
    !value.propertyId ||
    (value.direction !== "asc" && value.direction !== "desc")
  ) {
    return null;
  }
  return { propertyId: value.propertyId, direction: value.direction };
}

/**
 * Reads an untrusted filter group, dropping every condition that is not
 * recognizable and the whole group when nothing survives.
 */
function parseFilterGroup(value: unknown, depth: number): FilterGroup | null {
  if (!isRecord(value) || depth > MAX_FILTER_DEPTH) {
    return null;
  }
  if (value.conjunction !== "and" && value.conjunction !== "or") {
    return null;
  }
  if (!Array.isArray(value.conditions)) {
    return null;
  }
  const conditions = value.conditions
    .map((condition) =>
      isRecord(condition) && "conjunction" in condition
        ? parseFilterGroup(condition, depth + 1)
        : parseFilterCondition(condition)
    )
    .filter((condition): condition is FilterCondition | FilterGroup =>
      Boolean(condition)
    );
  return conditions.length
    ? { conjunction: value.conjunction, conditions }
    : null;
}

/**
 * Reads an untrusted filter condition. Exported for the block attributes an
 * older version wrote, which held a single bare condition.
 *
 * @param value the parsed condition.
 * @returns the condition, or null when it is not a valid one.
 */
export function parseFilterCondition(value: unknown): FilterCondition | null {
  if (!isRecord(value)) {
    return null;
  }
  const { propertyId, operator } = value;
  if (typeof propertyId !== "string" || !propertyId) {
    return null;
  }
  if (
    typeof operator !== "string" ||
    !Object.values<string>(FilterOperator).includes(operator)
  ) {
    return null;
  }
  return {
    propertyId,
    operator: operator as FilterOperator,
    ...(isPropertyValue(value.value) ? { value: value.value } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPropertyValue(value: unknown): value is PropertyValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}
