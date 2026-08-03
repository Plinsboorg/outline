import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import Icon from "@shared/components/Icon";
import { ProsemirrorDataHelper } from "@shared/utils/ProsemirrorDataHelper";
import type Database from "~/models/Database";
import type Document from "~/models/Document";
import type { RefHandle } from "~/components/EditableTitle";
import Text from "~/components/Text";
import DocumentMenu from "~/menus/DocumentMenu";
import useBoolean from "~/hooks/useBoolean";
import { useDocumentMenuAction } from "~/hooks/useDocumentMenuAction";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import { documentPath } from "~/utils/routeHelpers";
import DocumentRow from "./DocumentRow";
import { useSidebarContext } from "./SidebarContext";
import SidebarLink from "./SidebarLink";

type Props = {
  /** The database whose rows to list. */
  database: Database;
  /** The nesting depth to render the rows at. */
  depth: number;
};

/** The most rows fetched for the sidebar listing of a database. */
const MAX_SIDEBAR_ROWS = 25;

/**
 * The rows of a database, listed in the sidebar under the database's own
 * document link the way child documents are: each row is a full document row
 * with inline rename, a "+" that creates a sub-item, the document menu, and
 * its own sub-items nested beneath it. Capped so a large database cannot
 * flood the sidebar.
 */
function DatabaseRowLinks({ database, depth }: Props) {
  const { t } = useTranslation();
  const { documents } = useStores();
  const history = useHistory();

  const allRows = documents.inDatabase(database.id);

  React.useEffect(() => {
    void documents
      .fetchInDatabase({ databaseId: database.id, limit: MAX_SIDEBAR_ROWS })
      .catch((error) => toast.error(errToString(error)));
  }, [documents, database.id]);

  // sub-items render beneath their parent row; only rows without a loaded
  // parent sit at the first level
  const rowIds = new Set(allRows.map((row) => row.id));
  const topLevel = allRows.filter(
    (row) => !row.parentDocumentId || !rowIds.has(row.parentDocumentId)
  );

  return (
    <>
      {topLevel.map((row) => (
        <DatabaseRowLink
          key={row.id}
          row={row}
          allRows={allRows}
          database={database}
          depth={depth}
        />
      ))}
      {allRows.length === 0 && (
        <SidebarLink
          label={
            <Text type="tertiary" size="small" italic>
              {t("Empty")}
            </Text>
          }
          depth={depth}
        />
      )}
      {allRows.length >= MAX_SIDEBAR_ROWS && (
        <SidebarLink
          label={
            <Text type="tertiary" size="small">
              {t("Show all")}…
            </Text>
          }
          onClick={() => history.push(database.path)}
          depth={depth}
        />
      )}
    </>
  );
}

/**
 * One row of a database in the sidebar, with the affordances an ordinary
 * document link has, and its sub-items listed beneath it when expanded.
 */
const DatabaseRowLink = observer(function DatabaseRowLink_({
  row,
  allRows,
  database,
  depth,
}: {
  row: Document;
  allRows: Document[];
  database: Database;
  depth: number;
}) {
  const { documents } = useStores();
  const history = useHistory();
  const sidebarContext = useSidebarContext();
  const can = usePolicy(row);
  const [expanded, setExpanded] = React.useState(false);
  const [menuOpen, handleMenuOpen, handleMenuClose] = useBoolean();
  const editableTitleRef = React.useRef<RefHandle>(null);

  const subItems = allRows.filter(
    (item) => item.parentDocumentId === row.id && item.id !== row.id
  );

  const handleTitleChange = React.useCallback(
    async (value: string) => {
      await documents.update({ id: row.id, title: value });
    },
    [documents, row.id]
  );

  const handleRename = React.useCallback(() => {
    editableTitleRef.current?.setIsEditing(true);
  }, []);

  const handleDisclosureClick = React.useCallback(
    (ev?: React.MouseEvent<HTMLElement>) => {
      ev?.preventDefault();
      setExpanded((prev) => !prev);
    },
    []
  );

  const handleExpand = React.useCallback(() => {
    setExpanded(true);
  }, []);

  const handleCollapse = React.useCallback(() => {
    setExpanded(false);
  }, []);

  const handleCreateSubItem = React.useCallback(
    async (input: string) => {
      const newDocument = await documents.create(
        {
          title: input,
          collectionId: database.collectionId ?? undefined,
          databaseId: database.id,
          parentDocumentId: row.id,
          data: ProsemirrorDataHelper.getEmpty(),
        },
        { publish: true }
      );
      setExpanded(true);
      history.push({
        pathname: documentPath(newDocument),
        state: { sidebarContext },
      });
    },
    [documents, database, row.id, history, sidebarContext]
  );

  const contextMenuAction = useDocumentMenuAction({
    documentId: row.id,
    onRename: handleRename,
  });

  const toPath = React.useMemo(
    () => ({
      pathname: row.path,
      state: { title: row.title, sidebarContext },
    }),
    [row.path, row.title, sidebarContext]
  );

  const iconElement = row.icon ? (
    <Icon
      value={row.icon}
      color={row.color ?? undefined}
      initial={row.initial}
    />
  ) : undefined;

  return (
    <>
      <DocumentRow
        documentId={row.id}
        document={row}
        to={toPath}
        depth={depth}
        icon={iconElement}
        canEdit={can.update}
        labelText={row.titleWithDefault}
        onTitleChange={handleTitleChange}
        editableTitleRef={editableTitleRef}
        expanded={expanded}
        hasChildren={subItems.length > 0}
        onDisclosureClick={handleDisclosureClick}
        onExpand={handleExpand}
        onCollapse={handleCollapse}
        menu={
          <DocumentMenu
            document={row}
            onRename={handleRename}
            onOpen={handleMenuOpen}
            onClose={handleMenuClose}
          />
        }
        menuOpen={menuOpen}
        canCreateChild={can.createChildDocument}
        onCreateChild={handleCreateSubItem}
        contextAction={contextMenuAction}
      />
      {expanded &&
        subItems.map((subItem) => (
          <DatabaseRowLink
            key={subItem.id}
            row={subItem}
            allRows={allRows}
            database={database}
            depth={depth + 1}
          />
        ))}
    </>
  );
});

export default observer(DatabaseRowLinks);
