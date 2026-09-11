import type MarkdownIt from "markdown-it";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const hrefRegex = new RegExp(
  `^database://(${uuid})(?:/(${uuid}))?(?:\\?(.*))?$`,
  "i"
);

/**
 * A markdown-it plugin that converts a paragraph containing a single link of
 * the form `[…](database://<databaseId>[/<viewId>][?hidden=<propertyId>,…])`
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
 * @param hiddenProperties property ids hidden in this particular embed,
 * overriding the saved view's own visibility for this instance only.
 * @returns the serialized href.
 */
export function databaseHref(
  databaseId: string,
  viewId?: string | null,
  hiddenProperties?: readonly string[] | null
) {
  const base = `database://${databaseId}${viewId ? `/${viewId}` : ""}`;
  return hiddenProperties?.length
    ? `${base}?hidden=${hiddenProperties.join(",")}`
    : base;
}

/**
 * Parses a database block href back into its attributes.
 *
 * @param href the serialized href.
 * @returns the database id, view id and per-embed hidden property ids, or
 * undefined when not a database href.
 */
export function parseDatabaseHref(href: string):
  | {
      databaseId: string;
      viewId: string | null;
      hiddenProperties: string[];
    }
  | undefined {
  const match = href.match(hrefRegex);
  if (!match) {
    return undefined;
  }
  const hidden = new URLSearchParams(match[3] ?? "").get("hidden");
  return {
    databaseId: match[1],
    viewId: match[2] ?? null,
    hiddenProperties: hidden ? hidden.split(",").filter(Boolean) : [],
  };
}
