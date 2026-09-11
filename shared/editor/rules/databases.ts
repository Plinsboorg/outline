import type MarkdownIt from "markdown-it";
import type { FilterCondition, PropertyValue } from "../../types";
import { FilterOperator } from "../../types";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const hrefRegex = new RegExp(
  `^database://(${uuid})(?:/(${uuid}))?(?:\\?(.*))?$`,
  "i"
);

/** The per-embed settings a database block carries beyond what it points at. */
export type DatabaseBlockOptions = {
  /** Property ids hidden in this embed only. */
  hiddenProperties?: readonly string[] | null;
  /** A condition narrowing the view's own filter, in this embed only. */
  filter?: FilterCondition | null;
  /** Column widths in pixels, keyed by property id, in this embed only. */
  columnWidths?: Record<string, number> | null;
  /**
   * Whether a column's cells wrap, keyed by property id, overriding the saved
   * view's own setting in this embed only. A column with no entry follows the
   * view.
   */
  wrappedColumns?: Record<string, boolean> | null;
};

/**
 * A markdown-it plugin that converts a paragraph containing a single link of
 * the form `[…](database://<databaseId>[/<viewId>][?hidden=…&filter=…&widths=…])`
 * into a database block token, the serialized representation of the inline
 * database node.
 */
export default function databases(md: MarkdownIt) {
  md.core.ruler.after("inline", "databases", (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length - 1; i++) {
      if (
        tokens[i].type !== "inline" ||
        tokens[i - 1]?.type !== "paragraph_open"
      ) {
        continue;
      }

      const children = tokens[i].children || [];
      const [open, , close] = children;
      if (
        children.length !== 3 ||
        open?.type !== "link_open" ||
        close?.type !== "link_close"
      ) {
        continue;
      }

      const parsed = parseDatabaseHref(open.attrGet("href") || "");
      if (!parsed) {
        continue;
      }

      const token = new state.Token("database", "div", 0);
      token.attrSet("databaseId", parsed.databaseId);
      if (parsed.viewId) {
        token.attrSet("viewId", parsed.viewId);
      }
      if (parsed.hiddenProperties.length > 0) {
        token.attrSet("hiddenProperties", parsed.hiddenProperties.join(","));
      }
      if (parsed.filter) {
        token.attrSet("filter", JSON.stringify(parsed.filter));
      }
      if (Object.keys(parsed.columnWidths).length > 0) {
        token.attrSet("columnWidths", serializeWidths(parsed.columnWidths));
      }
      if (Object.keys(parsed.wrappedColumns).length > 0) {
        token.attrSet(
          "wrappedColumns",
          serializeWrapped(parsed.wrappedColumns)
        );
      }

      // replace the paragraph_open, inline and paragraph_close tokens
      tokens.splice(i - 1, 3, token);
    }

    return false;
  });
}

/**
 * Builds the link href used to serialize a database block to markdown.
 *
 * @param databaseId the database the block renders.
 * @param viewId the saved view to apply, if any.
 * @param options the per-embed settings layered on top of that view.
 * @returns the serialized href.
 */
export function databaseHref(
  databaseId: string,
  viewId?: string | null,
  options: DatabaseBlockOptions = {}
) {
  const base = `database://${databaseId}${viewId ? `/${viewId}` : ""}`;
  const params = new URLSearchParams();
  if (options.hiddenProperties?.length) {
    params.set("hidden", options.hiddenProperties.join(","));
  }
  if (options.filter) {
    params.set("filter", JSON.stringify(options.filter));
  }
  if (options.columnWidths && Object.keys(options.columnWidths).length > 0) {
    params.set("widths", serializeWidths(options.columnWidths));
  }
  if (
    options.wrappedColumns &&
    Object.keys(options.wrappedColumns).length > 0
  ) {
    params.set("wrap", serializeWrapped(options.wrappedColumns));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Parses a database block href back into its attributes.
 *
 * @param href the serialized href.
 * @returns the database id, view id and per-embed settings, or undefined when
 * not a database href.
 */
export function parseDatabaseHref(href: string):
  | {
      databaseId: string;
      viewId: string | null;
      hiddenProperties: string[];
      filter: FilterCondition | null;
      columnWidths: Record<string, number>;
      wrappedColumns: Record<string, boolean>;
    }
  | undefined {
  const match = href.match(hrefRegex);
  if (!match) {
    return undefined;
  }
  const params = new URLSearchParams(match[3] ?? "");
  const hidden = params.get("hidden");
  return {
    databaseId: match[1],
    viewId: match[2] ?? null,
    hiddenProperties: hidden ? hidden.split(",").filter(Boolean) : [],
    filter: parseFilter(params.get("filter")),
    columnWidths: parseWidths(params.get("widths")),
    wrappedColumns: parseWrapped(params.get("wrap")),
  };
}

/**
 * Reads a serialized filter condition, which arrives as untrusted markdown —
 * anything that is not a recognizable condition is dropped rather than
 * carried into a query.
 *
 * @param value the serialized condition.
 * @returns the condition, or null when there is not a valid one.
 */
export function parseFilter(value: string | null): FilterCondition | null {
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
  const { propertyId, operator } = parsed;
  if (typeof propertyId !== "string" || !propertyId) {
    return null;
  }
  if (!isFilterOperator(operator)) {
    return null;
  }
  return {
    propertyId,
    operator,
    ...(isPropertyValue(parsed.value) ? { value: parsed.value } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return (
    typeof value === "string" &&
    Object.values<string>(FilterOperator).includes(value)
  );
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

/**
 * Reads serialized column widths, dropping any entry that is not a positive
 * number of pixels.
 *
 * @param value the serialized widths, as `columnId:px` pairs.
 * @returns the widths by column id.
 */
export function parseWidths(value: string | null): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const pair of (value ?? "").split(",")) {
    const [columnId, px] = pair.split(":");
    const width = Number(px);
    if (columnId && Number.isFinite(width) && width > 0) {
      widths[columnId] = Math.round(width);
    }
  }
  return widths;
}

/**
 * Reads serialized wrap overrides, ignoring anything that is not a plain
 * on or off.
 *
 * @param value the serialized overrides, as `columnId:1` / `columnId:0` pairs.
 * @returns whether each named column wraps.
 */
export function parseWrapped(value: string | null): Record<string, boolean> {
  const wrapped: Record<string, boolean> = {};
  for (const pair of (value ?? "").split(",")) {
    const [columnId, flag] = pair.split(":");
    if (columnId && (flag === "0" || flag === "1")) {
      wrapped[columnId] = flag === "1";
    }
  }
  return wrapped;
}

function serializeWrapped(wrapped: Record<string, boolean>): string {
  return Object.entries(wrapped)
    .map(([columnId, wrap]) => `${columnId}:${wrap ? "1" : "0"}`)
    .join(",");
}

function serializeWidths(widths: Record<string, number>): string {
  return Object.entries(widths)
    .map(([columnId, width]) => `${columnId}:${Math.round(width)}`)
    .join(",");
}
