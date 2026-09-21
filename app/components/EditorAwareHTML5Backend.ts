import type { BackendFactory } from "dnd-core";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TouchBackend } from "react-dnd-touch-backend";

const topHandlerNames = [
  "handleTopDragStart",
  "handleTopDragStartCapture",
  "handleTopDragEnter",
  "handleTopDragEnterCapture",
  "handleTopDragLeaveCapture",
  "handleTopDragOver",
  "handleTopDragOverCapture",
  "handleTopDrop",
  "handleTopDropCapture",
  "handleTopDragEndCapture",
] as const;

const isWithinEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest(".ProseMirror"));

const isFileOverDropArea = (event: DragEvent): boolean =>
  Boolean(event.dataTransfer?.types.includes("Files")) &&
  event.target instanceof Element &&
  Boolean(event.target.closest("[data-drop-area]"));

export const EditorAwareHTML5Backend: BackendFactory = (
  manager,
  context,
  options
) => {
  // Определяем touch-устройство (смартфон/планшет с грубым указателем-пальцем)
  const isTouch =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
    window.matchMedia("(pointer: coarse)").matches;

  if (isTouch) {
    return TouchBackend(manager, context, {
      ...options,
      // 400 мс удержания пальца до старта drag'а (чтобы обычный скролл работал свободно)
      delayTouchStart: 400,
      ignoreContextMenu: true,
      enableMouseEvents: false,
    });
  }

  const backend = HTML5Backend(manager, context, options);
  const monitor = manager.getMonitor();

  const handlers = backend as unknown as Record<
    string,
    (event: DragEvent) => void
  >;

  for (const name of topHandlerNames) {
    const original = handlers[name];
    if (typeof original === "function") {
      handlers[name] = (event: DragEvent) => {
        if (isWithinEditor(event.target) || isFileOverDropArea(event)) {
          return;
        }
        if (
          (name === "handleTopDrop" || name === "handleTopDropCapture") &&
          !monitor.isDragging()
        ) {
          return;
        }
        original.call(backend, event);
      };
    }
  }

  return backend;
};
