import { registerNodeComponent } from "@shared/editor/lib/nodeComponents";
import DatabaseBlockView from "./components/DatabaseBlockView";

/**
 * Registers the app components that render node views for nodes whose
 * renderer cannot live beside the node itself — see
 * `@shared/editor/lib/nodeComponents`. Imported for its side effect by the
 * editor, which is the only thing that mounts a node view.
 */
registerNodeComponent("database", DatabaseBlockView);
