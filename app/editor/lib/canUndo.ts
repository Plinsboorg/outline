import { undoDepth } from "prosemirror-history";
import type { EditorState } from "prosemirror-state";
import { yUndoPluginKey } from "y-prosemirror";

/**
 * Whether there is anything to undo. Collaborative documents track history in
 * the Yjs undo manager, local ones in prosemirror-history.
 *
 * @param state the current editor state.
 * @returns true if an undo would change the document.
 */
export function canUndo(state: EditorState): boolean {
  const undoManager = yUndoPluginKey.getState(state)?.undoManager;
  if (undoManager) {
    return undoManager.undoStack.length > 0;
  }
  return undoDepth(state) > 0;
}
