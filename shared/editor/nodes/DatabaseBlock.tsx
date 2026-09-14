import type Token from "markdown-it/lib/token.mjs";
import type {
  NodeSpec,
  NodeType,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import type { Command } from "prosemirror-state";
import * as React from "react";
import type { Primitive } from "utility-types";
import type { DataViewOverride } from "../../types";
import {
  overrideFromLegacySettings,
  parseViewOverride,
  serializeViewOverride,
} from "../../utils/viewOverride";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { getNodeComponent } from "../lib/nodeComponents";
import databasesRule, {
  databaseHref,
  parseFilter,
  parseWidths,
  parseWrapped,
} from "../rules/databases";
import type { ComponentProps } from "../types";
import Node from "./Node";

/** The props the component rendering a database block is given. */
export type DatabaseBlockProps = ComponentProps & {
  /** Callback to set the database rendered by this block. */
  onChangeDatabase: (databaseId: string) => void;
  /** Callback to set the saved view rendered by this block. */
  onChangeView: (viewId: string | null) => void;
  /** Callback to set how this embed differs from the view it reads. */
  onChangeViewOverride: (override: DataViewOverride | null) => void;
  /** Callback to set whether this embed can be edited through. */
  onChangeReadOnly: (readOnly: boolean) => void;
  /** Callback to set which saved views this embed offers; empty offers all. */
  onChangeViewIds: (viewIds: string[]) => void;
};

/**
 * An atom block node that renders a live, editable view over the rows of a
 * database, inline in a host document. The node holds no row data — only the
 * database it reads, the saved view it reads through, and how this embed's
 * rendering differs from that view.
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
        // how this embed's rendering differs from the saved view it reads:
        // hidden or resized columns, its own filter, sorting, grouping. Lets
        // the same view show a different slice in each document it is
        // embedded in; an absent setting follows the view.
        viewOverride: {
          default: null,
        },
        // whether the database is shown without any way to change it here,
        // whatever the reader is otherwise allowed to do
        readOnly: {
          default: false,
        },
        // the saved views this embed offers, by id; empty offers every view
        // the database has, including ones added after the embed was written
        viewIds: {
          default: [],
        },
      },
      parseDOM: [
        {
          tag: "div.database-block",
          getAttrs: (dom: HTMLDivElement) => ({
            databaseId: dom.getAttribute("data-database-id") ?? "",
            viewId: dom.getAttribute("data-view-id"),
            readOnly: dom.getAttribute("data-read-only") === "true",
            viewIds: (dom.getAttribute("data-view-ids") ?? "")
              .split(",")
              .filter(Boolean),
            viewOverride:
              parseViewOverride(dom.getAttribute("data-view-override")) ??
              // blocks copied from a version that carried each per-embed
              // setting in an attribute of its own
              overrideFromLegacySettings({
                hiddenProperties: (
                  dom.getAttribute("data-hidden-properties") ?? ""
                )
                  .split(",")
                  .filter(Boolean),
                filter: parseFilter(dom.getAttribute("data-filter")),
                columnWidths: parseWidths(
                  dom.getAttribute("data-column-widths")
                ),
                wrappedColumns: parseWrapped(
                  dom.getAttribute("data-wrapped-columns")
                ),
              }),
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: "database-block",
          "data-database-id": node.attrs.databaseId,
          ...(node.attrs.viewId ? { "data-view-id": node.attrs.viewId } : {}),
          ...(serializeViewOverride(node.attrs.viewOverride)
            ? {
                "data-view-override": serializeViewOverride(
                  node.attrs.viewOverride
                ),
              }
            : {}),
          ...(node.attrs.readOnly ? { "data-read-only": "true" } : {}),
          ...(node.attrs.viewIds?.length
            ? { "data-view-ids": node.attrs.viewIds.join(",") }
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

  handleChangeViewOverride =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (viewOverride: DataViewOverride | null) =>
      this.setAttrs(props)({
        // an override that changes nothing is stored as nothing, so the block
        // serializes back to a bare reference
        viewOverride: serializeViewOverride(viewOverride) ? viewOverride : null,
      });

  handleChangeReadOnly =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (readOnly: boolean) =>
      this.setAttrs(props)({ readOnly });

  handleChangeViewIds =
    (props: { node: ProsemirrorNode; getPos: () => number }) =>
    (viewIds: string[]) =>
      this.setAttrs(props)({ viewIds });

  // the block renders a live, editable database — stores, routing, and the
  // same components the database page is built from — so its renderer lives
  // in the app and registers itself there. See lib/nodeComponents.
  component = (props: ComponentProps) => {
    const Component = getNodeComponent<DatabaseBlockProps>(this.name);
    return Component ? (
      <Component
        {...props}
        onChangeDatabase={this.handleChangeDatabase(props)}
        onChangeView={this.handleChangeView(props)}
        onChangeViewOverride={this.handleChangeViewOverride(props)}
        onChangeReadOnly={this.handleChangeReadOnly(props)}
        onChangeViewIds={this.handleChangeViewIds(props)}
      />
    ) : null;
  };

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
        viewOverride: node.attrs.viewOverride,
        readOnly: node.attrs.readOnly,
        viewIds: node.attrs.viewIds,
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
        viewOverride: parseViewOverride(token.attrGet("viewOverride")),
        readOnly: token.attrGet("readOnly") === "1",
        viewIds: (token.attrGet("viewIds") ?? "").split(",").filter(Boolean),
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
