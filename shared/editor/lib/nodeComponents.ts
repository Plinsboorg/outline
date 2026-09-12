import type { FunctionComponent } from "react";
import type { ComponentProps } from "../types";

/**
 * A registry of the React components that render node views, for nodes whose
 * renderer cannot live beside the node itself.
 *
 * Nodes are defined in shared code so the server can parse and serialize
 * documents with the same schema the client edits them in, which means a node
 * module may not import from the app bundle. A node that renders app UI —
 * store-backed, routed, sharing components with a page — registers its
 * renderer here from the app instead, and looks it up when the editor mounts
 * its node view. Nothing outside the browser ever renders one, so a node with
 * no registered component simply has no view.
 */
const components = new Map<string, FunctionComponent<never>>();

/**
 * Registers the component that renders a node's view.
 *
 * @param name the node name, as returned by the node's `name` getter.
 * @param component the component to render the node with.
 */
export function registerNodeComponent<T extends ComponentProps>(
  name: string,
  component: FunctionComponent<T>
) {
  components.set(name, component as FunctionComponent<never>);
}

/**
 * Returns the registered component for a node, if the app has registered one.
 *
 * @param name the node name.
 * @returns the component, or undefined outside the app.
 */
export function getNodeComponent<T extends ComponentProps>(
  name: string
): FunctionComponent<T> | undefined {
  return components.get(name) as FunctionComponent<T> | undefined;
}
