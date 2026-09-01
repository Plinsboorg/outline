import fractionalIndex from "fractional-index";
import * as React from "react";
import type { ConnectDragSource } from "react-dnd";
import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import Icon from "@shared/components/Icon";
import type { NavigationNode } from "@shared/types";
import type Collection from "~/models/Collection";
import type Database from "~/models/Database";
import type Document from "~/models/Document";
import type GroupMembership from "~/models/GroupMembership";
import type Star from "~/models/Star";
import type DocumentsStore from "~/stores/DocumentsStore";
import UserMembership from "~/models/UserMembership";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import ConfirmMoveDialog from "~/components/ConfirmMoveDialog";
import { planRowMove } from "@shared/utils/rowTree";
import useCurrentUser from "~/hooks/useCurrentUser";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import { AuthorizationError } from "~/utils/errors";
import { useSidebarLabelAndIcon } from "./useSidebarLabelAndIcon";

export type DragObject = NavigationNode & {
  depth: number;
  collectionId: string;
  /**
   * Whether the drag ghost should stay tethered to the sidebar. Defaults to
   * tethered when unset — the placeholder only lets the ghost follow the
   * cursor when this is explicitly `false` (e.g. drags from a document list).
   */
  constrainToSidebar?: boolean;
};

/**
 * Whether a dragged document is a database row.
 *
 * @param documents the documents store.
 * @param id the id of the dragged document.
 * @returns true when the document is a row.
 */
function isRow(documents: DocumentsStore, id: string): boolean {
  return !!documents.get(id)?.databaseId;
}

type MoveParams = {
  documentId: string;
  collectionId?: string;
  parentDocumentId?: string;
  index?: number;
};

/**
 * Returns a move that asks first when it would take a row out of its database.
 * A row's property values only survive the move as text in the body of the
 * document, and the columns themselves are gone, so this is not something to
 * do behind the user's back.
 *
 * @returns a function performing the move, with confirmation where needed.
 */
function useMoveDocument() {
  const { documents, databases, dialogs } = useStores();
  const { t } = useTranslation();

  return React.useCallback(
    async (params: MoveParams) => {
      const document = documents.get(params.documentId);
      const parent = params.parentDocumentId
        ? documents.get(params.parentDocumentId)
        : undefined;
      // dropping onto a database's document, or onto one of its rows, puts the
      // document in that database
      const targetDatabaseId = parent
        ? (parent.databaseId ??
          (databases.get(parent.id) ? parent.id : undefined))
        : undefined;

      if (!document?.databaseId || document.databaseId === targetDatabaseId) {
        await documents.move(params);
        return;
      }

      dialogs.openModal({
        title: t("Take out of database?"),
        content: (
          <ConfirmationDialog
            onSubmit={() => documents.move(params)}
            submitText={t("Take out")}
            savingText={`${t("Moving")}…`}
            danger
          >
            {t(
              "{{ documentName }} will no longer have the properties of its database. Their values are kept as text at the end of the document, but the properties themselves cannot be brought back by moving it in again.",
              { documentName: document.titleWithDefault }
            )}
          </ConfirmationDialog>
        ),
      });
    },
    [documents, databases, dialogs, t]
  );
}

function useHover(
  elementRef: React.RefObject<HTMLDivElement>,
  callback: () => void
) {
  const hoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

  const startHover = React.useCallback(() => {
    if (!hoverTimeoutRef.current) {
      hoverTimeoutRef.current = setTimeout(() => {
        hoverTimeoutRef.current = undefined;
        callback();
      }, 500);
    }
  }, [callback]);

  const unsetHover = React.useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
  }, []);

  // We set a timeout when the user first starts hovering over the document link,
  // to trigger expansion of children. Clear this timeout when they stop hovering.
  React.useEffect(() => {
    const element = elementRef.current;
    element?.addEventListener("dragleave", unsetHover);
    return () => element?.removeEventListener("dragleave", unsetHover);
  }, [elementRef, unsetHover]);

  return startHover;
}

/**
 * Hook for shared logic that allows dragging a Starred item
 *
 * @param star The related Star model.
 */
export function useDragStar(
  star: Star
): [{ isDragging: boolean }, ConnectDragSource] {
  const id = star.id;
  const { label: title, icon } = useSidebarLabelAndIcon(star);

  const [{ isDragging }, draggableRef, preview] = useDrag({
    type: "star",
    item: () => ({ id, title, icon }),
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  });

  React.useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return [{ isDragging }, draggableRef];
}

/**
 * Hook for shared logic that allows dropping documents and collections to create a star
 *
 * @param getIndex A function to get the index of the current item where the star should be inserted.
 */
export function useDropToCreateStar(getIndex?: () => string) {
  const accept = [
    "document",
    "collection",
    "userMembership",
    "groupMembership",
  ];
  const { documents, stars, collections, userMemberships, groupMemberships } =
    useStores();

  return useDrop<
    DragObject,
    Promise<void>,
    { isOverCursor: boolean; isDragging: boolean }
  >({
    accept,
    drop: async (item, monitor) => {
      // A more specific drop target (e.g. a reorder cursor) has already
      // handled this drop, so avoid creating a duplicate star.
      if (monitor.didDrop()) {
        return;
      }

      const type = monitor.getItemType();
      let model;

      if (type === "collection") {
        model = collections.get(item.id);
      } else if (type === "userMembership") {
        model = userMemberships.get(item.id)?.document;
      } else if (type === "groupMembership") {
        model = groupMemberships.get(item.id)?.document;
      } else {
        model = documents.get(item.id);
      }
      await model?.star(
        getIndex?.() ?? fractionalIndex(null, stars.orderedData[0].index)
      );
    },
    collect: (monitor) => ({
      isOverCursor: !!monitor.isOver({ shallow: true }),
      isDragging: accept.includes(String(monitor.getItemType())),
    }),
  });
}

/**
 * Hook for shared logic that allows dropping stars to reorder
 *
 * @param getIndex A function to get the index of the current item where the star should be inserted.
 */
export function useDropToReorderStar(getIndex?: () => string) {
  const { stars } = useStores();

  return useDrop<
    DragObject,
    Promise<void>,
    { isOverCursor: boolean; isDragging: boolean }
  >({
    accept: "star",
    drop: async (item) => {
      const star = stars.get(item.id);
      void star?.save({
        index:
          getIndex?.() ?? fractionalIndex(null, stars.orderedData[0].index),
      });
    },
    collect: (monitor) => ({
      isOverCursor: !!monitor.isOver(),
      isDragging: monitor.getItemType() === "star",
    }),
  });
}

/**
 * Hook for shared logic that allows dragging documents.
 *
 * @param node The NavigationNode model to drag.
 * @param depth The depth of the node in the sidebar.
 * @param document The related Document model.
 * @param isEditing Whether the sidebar item is currently being edited.
 * @param constrainToSidebar Whether the drag ghost should stay tethered to the
 * sidebar. Defaults to true; pass false when dragging from outside the sidebar
 * (e.g. a document list) so the ghost follows the cursor.
 */
export function useDragDocument(
  node: NavigationNode,
  depth: number,
  document?: Document,
  isEditing?: boolean,
  constrainToSidebar = true
) {
  const icon = document?.icon || node.icon || node.emoji;
  const color = document?.color || node.color;
  const initial = document?.initial || node.title;

  const [{ isDragging }, draggableRef, preview] = useDrag<
    DragObject,
    Promise<void>,
    { isDragging: boolean }
  >({
    type: "document",
    item: () =>
      ({
        ...node,
        depth,
        icon: icon ? (
          <Icon initial={initial} value={icon} color={color} />
        ) : undefined,
        collectionId: document?.collectionId || "",
        constrainToSidebar,
      }) as DragObject,
    canDrag: () => !!document?.isActive && !isEditing,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  React.useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return [{ isDragging }, draggableRef] as const;
}

export function useDropToChangeCollection(
  collection: Collection,
  expandNode: () => void,
  parentRef: React.RefObject<HTMLDivElement>
) {
  const { t } = useTranslation();
  const { documents, collections, dialogs, policies } = useStores();
  const can = usePolicy(collection);
  const moveDocument = useMoveDocument();
  const startHover = useHover(parentRef, expandNode);

  return useDrop<
    DragObject,
    Promise<void>,
    { isOver: boolean; canDrop: boolean }
  >({
    accept: "document",
    drop: async (item, monitor) => {
      if (monitor.didDrop()) {
        return;
      }

      const { id, collectionId } = item;
      const prevCollection = collections.get(collectionId);
      const document = documents.get(id);

      // a row dropped on a collection leaves its database, which is asked
      // about rather than folded into the permission question below
      if (isRow(documents, id)) {
        await moveDocument({
          documentId: id,
          collectionId: collection.id,
          index: 0,
        });
        return;
      }

      if (
        prevCollection &&
        prevCollection.permission !== collection.permission &&
        !document?.isDraft
      ) {
        dialogs.openModal({
          title: t("Change permissions?"),
          content: (
            <ConfirmMoveDialog item={item} collection={collection} index={0} />
          ),
        });
      } else {
        try {
          await documents.move({
            documentId: id,
            collectionId: collection.id,
            index: 0,
          });
          expandNode();
        } catch (err) {
          if (err instanceof AuthorizationError) {
            toast.error(
              t(
                "You do not have permission to move {{ documentName }} to the {{ collectionName }} collection",
                {
                  documentName: item.title,
                  collectionName: collection.name,
                }
              )
            );
          } else {
            toast.error(errToString(err));
          }
        }
      }
    },
    canDrop: (item) => can.createDocument && !!policies.abilities(item.id).move,
    hover: (_, monitor) => {
      if (
        collection.hasDocuments &&
        monitor.canDrop() &&
        monitor.isOver({ shallow: true })
      ) {
        startHover();
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop(),
    }),
  });
}

/**
 * Hook for shared logic that allows dropping documents to reparent
 *
 * @param node The NavigationNode model to drop.
 * @param setExpanded A function to expand the parent node.
 * @param parentRef A ref to the parent element that will be used to detect when the user is no longer hovering..
 */
export function useDropToReparentDocument(
  node: NavigationNode | undefined,
  setExpanded: () => void,
  parentRef: React.RefObject<HTMLDivElement>
) {
  const { t } = useTranslation();
  const { documents, collections, dialogs, policies } = useStores();
  const hasChildDocuments = !!node?.children.length;
  const document = node ? documents.get(node.id) : undefined;
  const pathToNode = React.useMemo(
    () => document?.pathTo.map((item) => item.id),
    [document]
  );
  const moveDocument = useMoveDocument();

  const startHover = useHover(parentRef, setExpanded);

  return useDrop<DragObject, Promise<void>, { isOverReparent: boolean }>({
    accept: "document",
    drop: async (item, monitor) => {
      if (monitor.didDrop() || !node) {
        return;
      }

      // a row nests under the document it was dropped on, or leaves its
      // database to do so — either way the move knows what to ask
      if (isRow(documents, item.id)) {
        await moveDocument({
          documentId: item.id,
          parentDocumentId: node.id,
        });
        setExpanded();
        return;
      }

      const collection = node.collectionId
        ? collections.get(node.collectionId)
        : undefined;
      const prevCollection = collections.get(item.collectionId);

      if (
        collection &&
        prevCollection &&
        prevCollection.permission !== collection.permission
      ) {
        dialogs.openModal({
          title: t("Change permissions?"),
          content: (
            <ConfirmMoveDialog
              item={item}
              collection={collection}
              parentDocumentId={node.id}
            />
          ),
        });
      } else {
        try {
          await documents.move({
            documentId: item.id,
            parentDocumentId: node.id,
          });
          setExpanded();
        } catch (err) {
          if (err instanceof AuthorizationError) {
            toast.error(
              t(
                "{{ documentName }} cannot be moved within {{ parentDocumentName }}",
                {
                  documentName: item.title,
                  parentDocumentName: node.title,
                }
              )
            );
          } else {
            toast.error(errToString(err));
          }
        }
      }
    },
    canDrop: (item) => {
      if (!node || item.id === node.id || !policies.abilities(item.id).move) {
        return false;
      }

      if (!document) {
        return true; // optimistic, in case the document is not loaded yet; server will check for permissions before performing the move.
      }

      return document.isActive && !!pathToNode && !pathToNode.includes(item.id);
    },
    hover: (_item, monitor) => {
      // Enables expansion of document children when hovering over the document
      // for more than half a second.
      if (
        hasChildDocuments &&
        monitor.canDrop() &&
        monitor.isOver({
          shallow: true,
        })
      ) {
        startHover();
      }
    },
    // Collected values must stay unchanged while the target is not hovered.
    // Collecting global drag state (e.g. a bare canDrop) re-renders every
    // sidebar row at drag start and drop.
    collect: (monitor) => ({
      isOverReparent: monitor.isOver({ shallow: true }) && monitor.canDrop(),
    }),
  });
}

/**
 * Hook allowing a database row to be dropped below another row in the sidebar,
 * which arranges it as that row's sibling. Rows are ordered by their own
 * fractional index rather than by the collection's document structure, so they
 * move through databases.move_row instead of documents.move — the same call
 * the table's row drag makes, planned by the same helper.
 *
 * @param database the database both rows belong to.
 * @param row the row the cursor sits beneath.
 * @returns the react-dnd drop target for the cursor.
 */
export function useDropToReorderRow(database: Database, row: Document) {
  const { t } = useTranslation();
  const { documents, databases } = useStores();

  return useDrop<DragObject, Promise<void>, { isOverReorder: boolean }>({
    accept: "document",
    canDrop: (item: DragObject) =>
      item.id !== row.id && documents.get(item.id)?.databaseId === database.id,
    drop: async (item, monitor) => {
      if (monitor.didDrop()) {
        return;
      }
      const dragged = documents.get(item.id);
      if (!dragged) {
        return;
      }
      try {
        const plan = planRowMove(
          documents.inDatabase(database.id),
          item.id,
          row.id,
          "after"
        );
        if (plan.status === "cycle") {
          toast.error(t("A row cannot be nested under its own sub-item"));
          return;
        }
        if (plan.status === "none") {
          return;
        }
        await databases.moveRow(
          database,
          dragged,
          plan.index,
          plan.parentDocumentId
        );
      } catch (err) {
        toast.error(errToString(err));
      }
    },
    collect: (monitor) => ({
      isOverReorder: !!monitor.isOver({ shallow: true }) && monitor.canDrop(),
    }),
  });
}

/**
 * Hook for shared logic that allows dropping documents to reorder
 *
 * @param node The NavigationNode model to drop.
 * @param collection The related Collection model, if published
 * @param getMoveParams A function to get the move parameters for the document.
 */
export function useDropToReorderDocument(
  node: NavigationNode,
  collection: Collection | undefined,
  getMoveParams: (item: DragObject) =>
    | undefined
    | {
        documentId: string;
        collectionId: string;
        parentDocumentId: string | undefined;
        index: number;
      }
) {
  const { t } = useTranslation();
  const { documents, collections, dialogs, policies } = useStores();
  const moveDocument = useMoveDocument();

  const document = documents.get(node.id);

  return useDrop<DragObject, Promise<void>, { isOverReorder: boolean }>({
    accept: "document",
    canDrop: (item: DragObject) => {
      if (item.id === node.id || (document && !document.isActive)) {
        return false;
      }
      return !!policies.abilities(item.id).move;
    },
    drop: async (item) => {
      if (!collection?.isManualSort && item.collectionId === collection?.id) {
        toast.message(
          t(
            "You can't reorder documents in an alphabetically sorted collection"
          )
        );
        return;
      }

      const params = getMoveParams(item);

      if (params) {
        // a row landing among ordinary documents leaves its database, which
        // the move asks about before going ahead
        if (isRow(documents, item.id)) {
          await moveDocument(params);
          return;
        }

        const prevCollection = collections.get(item.collectionId);

        if (
          collection &&
          prevCollection &&
          prevCollection.permission !== collection.permission
        ) {
          dialogs.openModal({
            title: t("Change permissions?"),
            content: (
              <ConfirmMoveDialog
                item={item}
                collection={collection}
                {...params}
              />
            ),
          });
        } else {
          try {
            await documents.move(params);
          } catch (err) {
            if (err instanceof AuthorizationError) {
              toast.error(
                t("{{ documentName }} cannot be moved here", {
                  documentName: item.title,
                })
              );
            } else {
              toast.error(errToString(err));
            }
          }
        }
      }
    },
    // Collected values must stay unchanged while the target is not hovered.
    // Collecting global drag state (e.g. a bare canDrop) re-renders every
    // sidebar row at drag start and drop.
    collect: (monitor) => ({
      isOverReorder: monitor.isOver() && monitor.canDrop(),
    }),
  });
}

/**
 * Hook for shared logic that allows dragging user memberships.
 *
 * @param membership The UserMembership or GroupMembership model to drag.
 */
export function useDragMembership(
  membership: UserMembership | GroupMembership
) {
  const id = membership.id;
  const { label: title, icon } = useSidebarLabelAndIcon(membership);

  const [{ isDragging }, draggableRef, preview] = useDrag({
    type:
      membership instanceof UserMembership
        ? "userMembership"
        : "groupMembership",
    item: () => ({ id, title, icon }),
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  });

  React.useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return [{ isDragging }, draggableRef] as const;
}

/**
 * Hook for shared logic that allows dropping user memberships to reorder
 *
 * @param getIndex A function to get the index of the current item where the membership should be inserted.
 */
export function useDropToReorderUserMembership(getIndex?: () => string) {
  const { userMemberships } = useStores();
  const user = useCurrentUser();

  return useDrop<
    DragObject,
    Promise<void>,
    { isOverCursor: boolean; isDragging: boolean }
  >({
    accept: "userMembership",
    drop: async (item) => {
      const userMembership = userMemberships.get(item.id);
      void userMembership?.save({
        index:
          getIndex?.() ??
          fractionalIndex(null, user.documentMemberships[0].index),
      });
    },
    collect: (monitor) => ({
      isOverCursor: !!monitor.isOver(),
      isDragging: monitor.getItemType() === "userMembership",
    }),
  });
}

/**
 * Hook for shared logic that allows dropping documents and collections onto archive section
 */
export function useDropToArchive() {
  const accept = ["document", "collection"];
  const { documents, collections, policies } = useStores();
  const { t } = useTranslation();

  return useDrop<
    DragObject,
    Promise<void>,
    { isOverArchiveSection: boolean; isDragging: boolean }
  >({
    accept,
    drop: async (item, monitor) => {
      const type = monitor.getItemType();
      let model;

      if (type === "collection") {
        model = collections.get(item.id);
      } else {
        model = documents.get(item.id);
      }

      if (model) {
        await model.archive();
        toast.success(
          type === "collection"
            ? t("Collection archived")
            : t("Document archived")
        );
      }
    },
    canDrop: (item) => policies.abilities(item.id).archive,
    collect: (monitor) => ({
      isOverArchiveSection: !!monitor.isOver(),
      isDragging: monitor.canDrop(),
    }),
  });
}

export function useDropToUnpublish() {
  const { t } = useTranslation();
  const { policies, documents } = useStores();

  return useDrop<
    DragObject,
    Promise<void>,
    { isOver: boolean; canDrop: boolean }
  >({
    accept: "document",
    drop: async (item) => {
      const document = documents.get(item.id);
      if (!document) {
        return;
      }

      try {
        await document.unpublish({ detach: true });
        toast.success(
          t("Unpublished {{ documentName }}", {
            documentName: document.noun,
          })
        );
      } catch (err) {
        toast.error(errToString(err));
      }
    },
    canDrop: (item) => {
      const policy = policies.abilities(item.id);
      if (!policy) {
        return true; // optimistic, let the server check for the necessary permission.
      }

      return policy.unpublish;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });
}
