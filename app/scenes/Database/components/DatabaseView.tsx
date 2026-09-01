import { arrayMove } from "@dnd-kit/sortable";
import { observer } from "mobx-react";
import { SettingsIcon, SortManualIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import { s } from "@shared/styles";
import type {
  DataView,
  DataViewSummaries,
  DataViewSort,
  FilterCondition,
  Property,
  PropertyValue,
  SummaryAggregation,
} from "@shared/types";
import { DataViewType, PropertyType } from "@shared/types";
import { errToString } from "@shared/utils/error";
import {
  TITLE_COLUMN_ID,
  isGroupableProperty,
  normalizedColumnsForView,
  orderedPropertiesForView,
  visiblePropertiesForView,
} from "@shared/utils/properties";
import type Database from "~/models/Database";
import type Document from "~/models/Document";
import Button from "~/components/Button";
import DatabaseSchemaEditor from "~/components/Database/DatabaseSchemaEditor";
import Fade from "~/components/Fade";
import Flex from "~/components/Flex";
import { InputSelect } from "~/components/InputSelect";
import PlaceholderList from "~/components/List/Placeholder";
import NudeButton from "~/components/NudeButton";
import Tooltip from "~/components/Tooltip";
import { useComputed } from "~/hooks/useComputed";
import usePersistedState from "~/hooks/usePersistedState";
import usePolicy from "~/hooks/usePolicy";
import useDeleteRow from "~/hooks/useDeleteRow";
import useStores from "~/hooks/useStores";
import DatabaseBoard from "./DatabaseBoard";
import DatabaseGallery from "./DatabaseGallery";
import DatabaseList from "./DatabaseList";
import DatabaseTable from "./DatabaseTable";
import DatabaseTableFilter from "./DatabaseTableFilter";
import DatabaseViewProperties from "./DatabaseViewProperties";
import DatabaseViewTabs from "./DatabaseViewTabs";
import { buildRowTree, orderRowsByIndex, planRowMove } from "./rowTree";

type Props = {
  /** The database to render. */
  database: Database;
};

const PAGE_LIMIT = 100;
const NO_GROUPING = "";

/**
 * The body of a database: a tab bar of saved views, a toolbar for the active
 * view, the rows in that view's layout, and a summary footer.
 *
 * Sorting, filtering, grouping and column visibility all belong to the active
 * view and are persisted on it, so switching tabs switches the whole query
 * rather than only the layout.
 */
function DatabaseView({ database }: Props) {
  const { t } = useTranslation();
  const { databases, documents, dialogs } = useStores();
  const can = usePolicy(database);
  // the anchor document shares the database's id, so a documents response
  // may occupy the policy slot with document abilities that have no
  // createRow — row creation delegates to updating the document anyway
  const canCreateRow = can.createRow ?? can.update;

  const [persistedViewId, setPersistedViewId] = usePersistedState<
    string | undefined
  >(`database-view:${database.id}`, undefined);
  const [rows, setRows] = React.useState<Document[]>();
  const [summaries, setSummaries] = React.useState<DataViewSummaries>();
  const [hasMore, setHasMore] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [newRowId, setNewRowId] = React.useState<string>();
  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const [isSortOpen, setIsSortOpen] = React.useState(false);
  const [expandedRowIds, setExpandedRowIds] = React.useState<
    ReadonlySet<string>
  >(new Set());
  const isCreatingRef = React.useRef(false);

  // rows are held in local state here, so the deleted one has to be dropped
  // by hand — the store cannot reach into it
  const handleDeleteRow = useDeleteRow(
    React.useCallback(
      (row: Document) =>
        setRows((current) => current?.filter((item) => item.id !== row.id)),
      []
    )
  );

  const schema = React.useMemo(
    () => database.dataSchema ?? [],
    [database.dataSchema]
  );
  const groupableProperties = schema.filter(isGroupableProperty);

  const activeView = database.resolveView(persistedViewId);
  const orderedProperties = orderedPropertiesForView(schema, activeView);
  const visibleProperties = visiblePropertiesForView(schema, activeView);

  // where the title column sits among the visible columns of the table view —
  // it can be dragged behind property columns like any other
  const visibleColumnIds = new Set<string>([
    TITLE_COLUMN_ID,
    ...visibleProperties.map((property) => property.id),
  ]);
  const titleIndex = normalizedColumnsForView(schema, activeView)
    .filter((column) => visibleColumnIds.has(column.propertyId))
    .findIndex((column) => column.propertyId === TITLE_COLUMN_ID);

  const sort: DataViewSort | undefined = activeView?.sorts?.[0];
  const filter = activeView?.filter?.conditions?.[0] as
    | FilterCondition
    | undefined;

  // reveal the toolbar on first render when the view already filters or
  // sorts, so the active configuration is not invisible
  const didAutoOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (didAutoOpenRef.current) {
      return;
    }
    didAutoOpenRef.current = true;
    if (filter) {
      setIsFilterOpen(true);
    }
    if (sort) {
      setIsSortOpen(true);
    }
  }, [filter, sort]);

  const groupByProperty = activeView?.groupBy
    ? database.getProperty(activeView.groupBy)
    : undefined;
  const boardGroupByProperty =
    groupByProperty && isGroupableProperty(groupByProperty)
      ? groupByProperty
      : groupableProperties[0];
  const listGroupProperty =
    groupByProperty && isGroupableProperty(groupByProperty)
      ? groupByProperty
      : undefined;

  const viewType =
    activeView?.type === DataViewType.Board && groupableProperties.length === 0
      ? DataViewType.Table
      : (activeView?.type ?? DataViewType.Table);

  const query = React.useCallback(
    (offset: number) =>
      documents.fetchInDatabase({
        databaseId: database.id,
        limit: PAGE_LIMIT,
        offset,
        propertySorts: activeView?.sorts?.length ? activeView.sorts : undefined,
        filter: activeView?.filter,
        summariesForViewId: activeView?.id,
      }),
    // schema is not part of the request, but a schema change can rewrite row
    // values on the server — e.g. toggling auto-numbering — so rows are
    // refetched whenever it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documents, database.id, activeView, schema]
  );

  React.useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const result = await query(0);
        if (!stale) {
          setRows(result.rows);
          setSummaries(result.summaries);
          setHasMore(result.rows.length === PAGE_LIMIT);
        }
      } catch (error) {
        toast.error(errToString(error));
      }
    }
    void load();
    return () => {
      stale = true;
    };
  }, [query]);

  const handleLoadMore = React.useCallback(async () => {
    if (!rows) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const result = await query(rows.length);
      setRows((current) => [...(current ?? []), ...result.rows]);
      setHasMore(result.rows.length === PAGE_LIMIT);
    } catch (error) {
      toast.error(errToString(error));
    } finally {
      setIsLoadingMore(false);
    }
  }, [rows, query]);

  const updateActiveView = React.useCallback(
    async (attrs: Partial<DataView>) => {
      if (!activeView) {
        return;
      }
      const views = (database.views ?? []).map((view) =>
        view.id === activeView.id ? { ...view, ...attrs } : view
      );
      try {
        await database.save({ views });
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database, activeView]
  );

  const handleSetSort = React.useCallback(
    (propertyId: string, direction: "asc" | "desc" | null) => {
      const next: DataViewSort[] = direction ? [{ propertyId, direction }] : [];
      void updateActiveView({ sorts: next });
    },
    [updateActiveView]
  );

  const handleFilter = React.useCallback(
    (condition?: FilterCondition) => {
      void updateActiveView({
        filter: condition
          ? { conjunction: "and", conditions: [condition] }
          : undefined,
      });
    },
    [updateActiveView]
  );

  const handleNewRow = React.useCallback(
    async (group?: { propertyId: string; value: PropertyValue }) => {
      if (isCreatingRef.current) {
        return;
      }
      isCreatingRef.current = true;
      try {
        // the server places the row in the anchor document's collection
        const document = await documents.create(
          {
            title: "",
            collectionId: database.collectionId ?? undefined,
            databaseId: database.id,
          },
          { publish: true }
        );
        if (group && group.value !== null) {
          await document.setProperty(group.propertyId, group.value);
        }
        setRows((current) => [...(current ?? []), document]);
        setNewRowId(document.id);
      } catch (error) {
        toast.error(errToString(error));
      } finally {
        isCreatingRef.current = false;
      }
    },
    [documents, database]
  );

  const handleNewRowDone = React.useCallback(() => {
    setNewRowId(undefined);
  }, []);

  // an unsorted view shows the manual arrangement, read from the rows' own
  // indexes rather than the order they arrived in — so a row moved in the
  // sidebar takes its new place here without a refetch, and vice versa. A
  // sorted view keeps the order the server sorted it into.
  const orderedRows = useComputed(
    () => (sort ? (rows ?? []) : orderRowsByIndex(rows ?? [])),
    [rows, sort]
  );

  // sub-items are rows parented under another row of the same database;
  // table and list views show them indented under their expanded parent
  const rowTree = React.useMemo(
    () => buildRowTree(orderedRows, expandedRowIds),
    [orderedRows, expandedRowIds]
  );

  const handleToggleRowExpand = React.useCallback((rowId: string) => {
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const handleNewSubItem = React.useCallback(
    async (parent: Document) => {
      if (isCreatingRef.current) {
        return;
      }
      isCreatingRef.current = true;
      try {
        const document = await documents.create(
          {
            title: "",
            collectionId: database.collectionId ?? undefined,
            databaseId: database.id,
            parentDocumentId: parent.id,
          },
          { publish: true }
        );
        setRows((current) => [...(current ?? []), document]);
        setExpandedRowIds((current) => new Set(current).add(parent.id));
        setNewRowId(document.id);
      } catch (error) {
        toast.error(errToString(error));
      } finally {
        isCreatingRef.current = false;
      }
    },
    [documents, database]
  );

  // plain-row variant for views that create without a preset group value, so
  // DOM click events are never mistaken for the group argument.
  const handleNewRowPlain = React.useCallback(
    () => void handleNewRow(),
    [handleNewRow]
  );

  const handleAddProperty = React.useCallback(
    async (property: Property) => {
      await database.save({
        dataSchema: [...(database.dataSchema ?? []), property],
      });
    },
    [database]
  );

  const handleUpdateProperty = React.useCallback(
    async (propertyId: string, updates: Partial<Property>) => {
      try {
        await database.save({
          dataSchema: (database.dataSchema ?? []).map((property) =>
            property.id === propertyId ? { ...property, ...updates } : property
          ),
        });
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database]
  );

  const handleDeleteProperty = React.useCallback(
    async (propertyId: string) => {
      try {
        await database.save({
          dataSchema: (database.dataSchema ?? []).filter(
            (property) => property.id !== propertyId
          ),
        });
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database]
  );

  const handleCreateView = React.useCallback(
    async (type: DataViewType) => {
      const id = uuidv4();
      const existing = (database.views ?? []).filter(
        (view) => view.type === type
      ).length;
      const name =
        existing > 0
          ? `${viewTypeName(type)} ${existing + 1}`
          : viewTypeName(type);
      const view = database.buildView(type, name, id);
      if (type === DataViewType.Board && groupableProperties.length > 0) {
        view.groupBy = groupableProperties[0].id;
      }
      try {
        await database.save({ views: [...(database.views ?? []), view] });
        setPersistedViewId(id);
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database, groupableProperties, setPersistedViewId]
  );

  const handleRenameView = React.useCallback(
    async (viewId: string, name: string) => {
      const views = (database.views ?? []).map((view) =>
        view.id === viewId ? { ...view, name } : view
      );
      try {
        await database.save({ views });
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database]
  );

  const handleDeleteView = React.useCallback(
    async (viewId: string) => {
      const views = (database.views ?? []).filter((view) => view.id !== viewId);
      if (views.length === 0) {
        return;
      }
      try {
        await database.save({ views });
        if (persistedViewId === viewId) {
          setPersistedViewId(views[0].id);
        }
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database, persistedViewId, setPersistedViewId]
  );

  const handleToggleProperty = React.useCallback(
    (propertyId: string, visible: boolean) => {
      const columns = normalizedColumnsForView(schema, activeView).map(
        (column) =>
          column.propertyId === propertyId ? { ...column, visible } : column
      );
      void updateActiveView({ columns });
    },
    [schema, activeView, updateActiveView]
  );

  const handleChangeSummary = React.useCallback(
    (propertyId: string, summary: SummaryAggregation | null) => {
      const columns = normalizedColumnsForView(schema, activeView).map(
        (column) =>
          column.propertyId === propertyId
            ? { ...column, summary: summary ?? undefined }
            : column
      );
      void updateActiveView({ columns });
    },
    [schema, activeView, updateActiveView]
  );

  // dropping next to a row makes the moved row its sibling, so dragging can
  // also pull a sub-item out to the top level or nest it elsewhere. The move
  // is planned by the same helper the sidebar uses, and applied by writing the
  // row's index — the displayed order follows from that, here and there.
  const handleMoveRow = React.useCallback(
    (documentId: string, overDocumentId: string) => {
      const row = orderedRows.find((item) => item.id === documentId);
      if (!row) {
        return;
      }
      let plan;
      try {
        plan = planRowMove(orderedRows, documentId, overDocumentId);
      } catch (error) {
        toast.error(errToString(error));
        return;
      }
      if (plan.status === "cycle") {
        toast.error(t("A row cannot be nested under its own sub-item"));
        return;
      }
      if (plan.status === "none") {
        return;
      }
      const { parentDocumentId } = plan;
      if (parentDocumentId) {
        setExpandedRowIds((current) => new Set(current).add(parentDocumentId));
      }
      void databases
        .moveRow(database, row, plan.index, parentDocumentId)
        .catch((error) => toast.error(errToString(error)));
    },
    [orderedRows, databases, database, t]
  );

  const handleResizeColumn = React.useCallback(
    (columnId: string, width: number) => {
      const columns = normalizedColumnsForView(schema, activeView).map(
        (column) =>
          column.propertyId === columnId ? { ...column, width } : column
      );
      void updateActiveView({ columns });
    },
    [schema, activeView, updateActiveView]
  );

  const handleToggleWrapColumn = React.useCallback(
    (columnId: string, wrap: boolean) => {
      const columns = normalizedColumnsForView(schema, activeView).map(
        (column) =>
          column.propertyId === columnId
            ? { ...column, wrap: wrap || undefined }
            : column
      );
      void updateActiveView({ columns });
    },
    [schema, activeView, updateActiveView]
  );

  const handleRenameTitle = React.useCallback(
    async (name: string) => {
      try {
        await database.save({ titleName: name });
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database]
  );

  const handleMoveProperty = React.useCallback(
    (propertyId: string, overPropertyId: string) => {
      const columns = normalizedColumnsForView(schema, activeView);
      const from = columns.findIndex(
        (column) => column.propertyId === propertyId
      );
      const to = columns.findIndex(
        (column) => column.propertyId === overPropertyId
      );
      if (from === -1 || to === -1 || from === to) {
        return;
      }
      void updateActiveView({ columns: arrayMove(columns, from, to) });
    },
    [schema, activeView, updateActiveView]
  );

  const handleChangeGroupBy = React.useCallback(
    (propertyId: string) => {
      void updateActiveView({
        groupBy: propertyId === NO_GROUPING ? undefined : propertyId,
      });
    },
    [updateActiveView]
  );

  const handleEditSchema = React.useCallback(() => {
    dialogs.openModal({
      title: t("Database properties"),
      content: (
        <DatabaseSchemaEditor
          databaseId={database.id}
          onSubmit={dialogs.closeAllModals}
        />
      ),
    });
  }, [t, dialogs, database.id]);

  if (!rows) {
    return <PlaceholderList count={5} />;
  }

  // rollups are computed at read time; image values are attachment urls with
  // no meaningful order
  const sortableProperties = schema.filter(
    (property) =>
      property.type !== PropertyType.Rollup &&
      property.type !== PropertyType.Image
  );
  const showGroupSelect =
    (viewType === DataViewType.Board || viewType === DataViewType.List) &&
    groupableProperties.length > 0 &&
    can.update;
  const toolbarVisible = isFilterOpen || isSortOpen || showGroupSelect;

  return (
    <Fade>
      <DatabaseViewTabs
        views={database.views ?? []}
        activeViewId={activeView?.id}
        canEdit={can.update}
        onSelect={setPersistedViewId}
        onCreate={handleCreateView}
        onRename={handleRenameView}
        onDelete={handleDeleteView}
        trailing={
          <>
            <Tooltip content={t("Filter")}>
              <ToolbarIconButton
                type="button"
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                aria-label={t("Filter")}
                $active={!!filter}
                size={26}
              >
                <FilterFunnelIcon />
              </ToolbarIconButton>
            </Tooltip>
            <Tooltip content={t("Sort")}>
              <ToolbarIconButton
                type="button"
                onClick={() => setIsSortOpen(!isSortOpen)}
                aria-label={t("Sort")}
                $active={!!sort}
                size={26}
              >
                <SortManualIcon size={20} />
              </ToolbarIconButton>
            </Tooltip>
            {can.update && (
              <Tooltip content={t("Database properties")}>
                <ToolbarIconButton
                  type="button"
                  onClick={handleEditSchema}
                  aria-label={t("Database properties")}
                  size={26}
                >
                  <SettingsIcon size={20} />
                </ToolbarIconButton>
              </Tooltip>
            )}
            {can.update &&
              schema.length > 0 &&
              viewType !== DataViewType.Table && (
                <DatabaseViewProperties
                  schema={orderedProperties}
                  view={activeView}
                  onToggle={handleToggleProperty}
                />
              )}
          </>
        }
      />

      {toolbarVisible && (
        <Toolbar align="center" gap={8}>
          {isFilterOpen && (
            <DatabaseTableFilter
              schema={schema}
              filter={filter}
              onChange={handleFilter}
            />
          )}
          {isSortOpen && (
            <>
              <InputSelect
                options={[
                  {
                    type: "item" as const,
                    label: t("No sorting"),
                    value: NO_GROUPING,
                  },
                  {
                    type: "item" as const,
                    label: t("Sort by {{ propertyName }}", {
                      propertyName: database.titleName ?? t("Title"),
                    }),
                    value: TITLE_COLUMN_ID,
                  },
                  ...sortableProperties.map((property) => ({
                    type: "item" as const,
                    label: t("Sort by {{ propertyName }}", {
                      propertyName: property.name,
                    }),
                    value: property.id,
                  })),
                ]}
                value={sort?.propertyId ?? NO_GROUPING}
                onChange={(value) =>
                  handleSetSort(
                    value,
                    value === NO_GROUPING ? null : (sort?.direction ?? "asc")
                  )
                }
                label={t("Sort by")}
                labelHidden
                short
              />
              {sort && (
                <InputSelect
                  options={[
                    {
                      type: "item" as const,
                      label: t("Ascending"),
                      value: "asc",
                    },
                    {
                      type: "item" as const,
                      label: t("Descending"),
                      value: "desc",
                    },
                  ]}
                  value={sort.direction}
                  onChange={(value) =>
                    handleSetSort(
                      sort.propertyId,
                      value === "desc" ? "desc" : "asc"
                    )
                  }
                  label={t("Direction")}
                  labelHidden
                  short
                />
              )}
            </>
          )}
          {showGroupSelect && (
            <InputSelect
              options={[
                ...(viewType === DataViewType.List
                  ? [
                      {
                        type: "item" as const,
                        label: t("No grouping"),
                        value: NO_GROUPING,
                      },
                    ]
                  : []),
                ...groupableProperties.map((property) => ({
                  type: "item" as const,
                  label: t("Group by {{ propertyName }}", {
                    propertyName: property.name,
                  }),
                  value: property.id,
                })),
              ]}
              value={activeView?.groupBy ?? NO_GROUPING}
              onChange={handleChangeGroupBy}
              label={t("Group by")}
              labelHidden
              short
            />
          )}
        </Toolbar>
      )}

      {viewType === DataViewType.Board && boardGroupByProperty ? (
        <DatabaseBoard
          rows={orderedRows}
          properties={visibleProperties}
          groupByProperty={boardGroupByProperty}
          onNewRow={canCreateRow ? handleNewRow : undefined}
          newRowId={newRowId}
          onNewRowDone={handleNewRowDone}
          onDeleteRow={handleDeleteRow}
        />
      ) : viewType === DataViewType.List ? (
        <DatabaseList
          // grouping splits rows apart, so sub-items are shown flat there —
          // only the ungrouped list nests them under their parent
          rows={listGroupProperty ? orderedRows : rowTree.visibleRows}
          properties={visibleProperties}
          groupByProperty={listGroupProperty}
          hasFilter={!!filter}
          onNewRow={canCreateRow ? handleNewRowPlain : undefined}
          newRowId={newRowId}
          onNewRowDone={handleNewRowDone}
          rowDepths={rowTree.depthById}
          parentRowIds={rowTree.parentIds}
          expandedRowIds={expandedRowIds}
          onToggleRowExpand={handleToggleRowExpand}
        />
      ) : viewType === DataViewType.Gallery ? (
        <DatabaseGallery
          rows={orderedRows}
          properties={visibleProperties}
          hasFilter={!!filter}
          onNewRow={canCreateRow ? handleNewRowPlain : undefined}
          newRowId={newRowId}
          onNewRowDone={handleNewRowDone}
          onDeleteRow={handleDeleteRow}
        />
      ) : (
        <DatabaseTable
          rows={rowTree.visibleRows}
          properties={visibleProperties}
          titleIndex={titleIndex}
          titleName={database.titleName ?? undefined}
          onRenameTitle={can.update ? handleRenameTitle : undefined}
          onResizeColumn={can.update ? handleResizeColumn : undefined}
          onToggleWrapColumn={can.update ? handleToggleWrapColumn : undefined}
          sort={sort}
          onSetSort={handleSetSort}
          hasFilter={!!filter}
          onNewRow={canCreateRow ? handleNewRowPlain : undefined}
          newRowId={newRowId}
          onNewRowDone={handleNewRowDone}
          schemaNames={schema.map((property) => property.name)}
          onAddProperty={can.update ? handleAddProperty : undefined}
          onUpdateProperty={can.update ? handleUpdateProperty : undefined}
          onHideProperty={(propertyId) =>
            handleToggleProperty(propertyId, false)
          }
          onDeleteProperty={handleDeleteProperty}
          onDeleteRow={handleDeleteRow}
          onMoveProperty={can.update ? handleMoveProperty : undefined}
          // a sorted view derives its order from the sort, so rows can only
          // be arranged by hand while no sort is applied
          onMoveRow={can.update && !sort ? handleMoveRow : undefined}
          rowDepths={rowTree.depthById}
          parentRowIds={rowTree.parentIds}
          expandedRowIds={expandedRowIds}
          listEndsAfter={rowTree.listEndsAfter}
          onToggleRowExpand={handleToggleRowExpand}
          onAddSubItem={canCreateRow ? handleNewSubItem : undefined}
          propertiesToggle={
            can.update && schema.length > 0 ? (
              <DatabaseViewProperties
                schema={orderedProperties}
                view={activeView}
                onToggle={handleToggleProperty}
              />
            ) : undefined
          }
          view={activeView}
          summaries={summaries}
          canEditSummaries={can.update}
          onChangeSummary={handleChangeSummary}
        />
      )}

      {hasMore && (
        <LoadMore align="center" justify="center">
          <Button
            type="button"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            neutral
          >
            {t("Load more")}
          </Button>
        </LoadMore>
      )}
    </Fade>
  );
}

/** The default display name for a newly created view of the given layout. */
function viewTypeName(type: DataViewType): string {
  switch (type) {
    case DataViewType.Board:
      return "Board";
    case DataViewType.List:
      return "List";
    case DataViewType.Gallery:
      return "Gallery";
    default:
      return "Table";
  }
}

/** A simple funnel glyph, as outline-icons has no filter icon. */
function FilterFunnelIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.5 6h13a1 1 0 0 1 .8 1.6L14 14v4.6a1 1 0 0 1-1.4.9l-2-.9a1 1 0 0 1-.6-.9V14L4.7 7.6A1 1 0 0 1 5.5 6z" />
    </svg>
  );
}

const ToolbarIconButton = styled(NudeButton)<{ $active?: boolean }>`
  color: ${(props) =>
    props.$active ? props.theme.accent : props.theme.textSecondary};
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${(props) =>
      props.$active ? props.theme.accent : props.theme.text};
  }
`;

const Toolbar = styled(Flex)`
  margin: 12px 0;
  flex-wrap: wrap;
`;

const LoadMore = styled(Flex)`
  margin: 12px 0;
`;

export default observer(DatabaseView);
