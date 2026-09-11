import type Token from "markdown-it/lib/token.mjs";
import type {
  NodeSpec,
  NodeType,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import type { Command } from "prosemirror-state";
import * as React from "react";
import type { Primitive } from "utility-types";
import type { FilterCondition } from "../../types";
import DatabaseBlockComponent from "../components/DatabaseBlock";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import databasesRule, {
  databaseHref,
  parseFilter,
  parseWidths,
  parseWrapped,
} from "../rules/databases";
import type { ComponentProps } from "../types";
import Node from "./Node";

/**
 * An atom block node that renders a live table over the documents of a
 * database collection, inline in a host document. The node stores no data —
 * only the collection (and optionally saved view) it reads from.
 */
export default class DatabaseBlock extends Node {
  get name() {
    return "database";
  }

  get rulePlugins() {
    return [databasesRule];
  }

  get schema(): NodeSpec {
    return {
      group: "block",
      atom: true,
      attrs: {
        databaseId: {
          default: "",
          validate: "string",
        },
        viewId: {
          default: null,
        },
        // property ids hidden in THIS embed only, layered on top of whatever
        // the referenced view already hides — lets the same database show
        // different columns in different documents without new saved views
        hiddenProperties: {
          default: [],
        },
        // a condition narrowing the view's own filter in THIS embed only, so
        // one saved view can show a different slice in each document
        filter: {
          default: null,
        },
        // column widths in pixels for THIS embed only, keyed by property id
        // (and "title" for the title column)
        columnWidths: {
          default: {},
        },
        // whether a column wraps in THIS embed, overriding the saved view's
        // own setting; a column with no entry follows the view
        wrappedColumns: {
          default: {},
        },
      },
      parseDOM: [
        {
          tag: "div.database-block",
          getAttrs: (dom: HTMLDivElement) => ({
            databaseId: dom.getAttribute("data-database-id") ?? "",
            viewId: dom.getAttribute("data-view-id"),
            hiddenProperties: (dom.getAttribute("data-hidden-properties") ?? "")
              .split(",")
              .filter(Boolean),
            filter: parseFilter(dom.getAttribute("data-filter")),
            columnWidths: parseWidths(dom.getAttribute("data-column-widths")),
            wrappedColumns: parseWrapped(
              dom.getAttribute("data-wrapped-columns")
            ),
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: "database-block",
          "data-database-id": node.attrs.databaseId,
          ...(node.attrs.viewId ? { "data-view-id": node.attrs.viewId } : {}),
          ...(node.attrs.hiddenProperties?.length
            ? {
                "data-hidden-properties": node.attrs.hiddenProperties.join(","),
              }
            : {}),
          ...(node.attrs.filter
            ? { "data-filter": JSON.stringify(node.attrs.filter) }
            : {}),
          ...(Object.keys(node.attrs.columnWidths ?? {}).length
            ? {
                "data-column-widths": Object.entries(
                  node.attrs.columnWidths ?? {}
                )
                  .map(([columnId, width]) => `${columnId}:${String(width)}`)
                  .join(","),
              }
            : {}),
          ...(Object.keys(node.attrs.wrappedColumns ?? {}).length
            ? {
                "data-wrapped-columns": Object.entries(
                  node.attrs.wrappedColumns ?? {}
                )
                  .map(([columnId, wrap]) => `${columnId}:${wrap ? "1" : "0"}`)
                  .join(","),
              }
            : {}),
        },
        "Database",
      ],
      leafText: () => "Database",
    };
  }

  handleChangeDatabase =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (databaseId: string) =>
      this.setAttrs(props)({ databaseId });

  handleChangeView =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (viewId: string | null) =>
      this.setAttrs(props)({ viewId });

  handleToggleProperty =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (propertyId: string) => {
      const current: string[] = props.node.attrs.hiddenProperties ?? [];
      this.setAttrs(props)({
        hiddenProperties: current.includes(propertyId)
          ? current.filter((id) => id !== propertyId)
          : [...current, propertyId],
      });
    };

  handleChangeFilter =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (filter: FilterCondition | null) =>
      this.setAttrs(props)({ filter });

  handleToggleWrap =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (columnId: string, wrap: boolean | null) => {
      const current: Record<string, boolean> =
        props.node.attrs.wrappedColumns ?? {};
      // null clears the override, handing the column back to the saved view
      const { [columnId]: _cleared, ...rest } = current;
      this.setAttrs(props)({
        wrappedColumns: wrap === null ? rest : { ...current, [columnId]: wrap },
      });
    };

  handleResizeColumn =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (columnId: string, width: number) => {
      const current: Record<string, number> =
        props.node.attrs.columnWidths ?? {};
      this.setAttrs(props)({
        columnWidths: { ...current, [columnId]: Math.round(width) },
      });
    };

  component = (props: ComponentProps) => (
    <DatabaseBlockComponent
      {...props}
      onChangeDatabase={this.handleChangeDatabase(props)}
      onChangeView={this.handleChangeView(props)}
      onToggleProperty={this.handleToggleProperty(props)}
      onChangeFilter={this.handleChangeFilter(props)}
      onResizeColumn={this.handleResizeColumn(props)}
      onToggleWrap={this.handleToggleWrap(props)}
    />
  );

  commands({ type }: { type: NodeType }) {
    return {
      database:
        (attrs: Record<string, Primitive>): Command =>
        (state, dispatch) => {
          dispatch?.(
            state.tr.replaceSelectionWith(type.create(attrs)).scrollIntoView()
          );
          return true;
        },
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    if (!node.attrs.databaseId) {
      return;
    }
    state.ensureNewLine();
    state.write(
      `[Database](${databaseHref(node.attrs.databaseId, node.attrs.viewId, {
        hiddenProperties: node.attrs.hiddenProperties,
        filter: node.attrs.filter,
        columnWidths: node.attrs.columnWidths,
        wrappedColumns: node.attrs.wrappedColumns,
      })})`
    );
    state.write("\n\n");
  }

  parseMarkdown() {
    return {
      node: "database",
      getAttrs: (token: Token) => ({
        databaseId: token.attrGet("databaseId"),
        viewId: token.attrGet("viewId"),
        hiddenProperties: (token.attrGet("hiddenProperties") ?? "")
          .split(",")
          .filter(Boolean),
        filter: parseFilter(token.attrGet("filter")),
        columnWidths: parseWidths(token.attrGet("columnWidths")),
        wrappedColumns: parseWrapped(token.attrGet("wrappedColumns")),
      }),
    };
  }

  /** Writes attributes onto this block's node, leaving the rest untouched. */
  private setAttrs =
    ({ node, getPos }: { node: ProsemirrorNode; getPos: () => number }) =>
    (attrs: Record<string, unknown>) => {
      const { view } = this.editor;
      const { tr } = view.state;
      view.dispatch(
        tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, ...attrs })
      );
    };
}
