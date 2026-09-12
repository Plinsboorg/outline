import type MarkdownIt from "markdown-it";
import type { DataViewOverride, FilterCondition } from "../../types";
import {
  overrideFromLegacySettings,
  parseFilterCondition,
  parseViewOverride,
  serializeViewOverride,
} from "../../utils/viewOverride";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const hrefRegex = new RegExp(
  `^database://(${uuid})(?:/(${uuid}))?(?:\\?(.*))?$`,
  "i"
);

/** The per-embed settings a database block carries beyond what it points at. */
export type DatabaseBlockOptions = {
  /**
   * How this embed's rendering differs from the saved view it reads — hidden
   * or resized columns, its own filter, and so on. Absent settings follow the
   * view.
   */
  viewOverride?: DataViewOverride | null;
};

/**
 * A markdown-it plugin that converts a paragraph containing a single link of
 * the form `[…](database://<databaseId>[/<viewId>][?v=<override>])`
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
      const serialized = serializeViewOverride(parsed.viewOverride);
      if (serialized) {
        token.attrSet("viewOverride", serialized);
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
  const serialized = serializeViewOverride(options.viewOverride);
  if (!serialized) {
    return base;
  }
  const params = new URLSearchParams();
  params.set("v", serialized);
  return `${base}?${params.toString()}`;
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
      viewOverride: DataViewOverride | null;
    }
  | undefined {
  const match = href.match(hrefRegex);
  if (!match) {
    return undefined;
  }
  const params = new URLSearchParams(match[3] ?? "");
  return {
    databaseId: match[1],
    viewId: match[2] ?? null,
    viewOverride:
      parseViewOverride(params.get("v")) ??
      // blocks written before the per-embed settings were one override
      overrideFromLegacySettings({
        hiddenProperties: (params.get("hidden") ?? "")
          .split(",")
          .filter(Boolean),
        filter: parseFilter(params.get("filter")),
        columnWidths: parseWidths(params.get("widths")),
        wrappedColumns: parseWrapped(params.get("wrap")),
      }),
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
  try {
    return parseFilterCondition(JSON.parse(value));
  } catch (_err) {
    return null;
  }
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
