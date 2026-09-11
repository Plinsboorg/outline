import { observer } from "mobx-react";
import { CheckmarkIcon, CollapsedIcon, EyeIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { PropertyChip } from "../../components/PropertyChip";
import { s } from "../../styles";
import type {
  DataView,
  FilterCondition,
  Property,
  PropertyValue,
} from "../../types";
import { DataViewType, PropertyType } from "../../types";
import {
  TITLE_COLUMN_ID,
  combineFilters,
  defaultFilterValue,
  filterOperatorLabels,
  filterOperatorsForProperty,
  groupByProperty,
  isGroupableProperty,
  isValuelessFilterOperator,
  visiblePropertiesForView,
} from "../../utils/properties";
import type { RowTree } from "../../utils/rowTree";
import { buildRowTree } from "../../utils/rowTree";
import useIsMounted from "../../hooks/useIsMounted";
import useStores from "../../hooks/useStores";
import type { ComponentProps } from "../types";
import PropertyValueLabel from "./PropertyValueLabel";

const ROW_LIMIT = 25;

type Props = ComponentProps & {
  /** Callback to set the database rendered by this block. */
  onChangeDatabase: (databaseId: string) => void;
  /** Callback to set the saved view rendered by this block. */
  onChangeView: (viewId: string | null) => void;
  /** Callback to toggle a property's visibility in this embed only. */
  onToggleProperty: (propertyId: string) => void;
  /** Callback to set the filter applied in this embed only. */
  onChangeFilter: (filter: FilterCondition | null) => void;
  /** Callback to persist a column's width in this embed only. */
  onResizeColumn: (columnId: string, width: number) => void;
  /** Callback to set whether a column wraps in this embed; null follows the
   * saved view again. */
  onToggleWrap: (columnId: string, wrap: boolean | null) => void;
};

type RowModel = {
  id: string;
  path: string;
  titleWithDefault: string;
  parentDocumentId?: string | null;
  propertyValue: (id: string) => PropertyValue | undefined;
};

/** How far one level of sub-item nesting indents a row, in pixels. */
const INDENT_WIDTH = 20;

/**
 * Renders the inline database block: a read-only live view over the rows of a
 * database, laid out as a table, board, list or gallery depending on the
 * referenced saved view. When the block has no database yet (freshly
 * inserted), it renders a picker of available databases.
 */
function DatabaseBlock({
  node,
  isEditable,
  onChangeDatabase,
  onChangeView,
  onToggleProperty,
  onChangeFilter,
  onResizeColumn,
  onToggleWrap,
}: Props) {
  const { t } = useTranslation();
  const { databases, documents } = useStores();
  const isMounted = useIsMounted();
  const { databaseId, viewId } = node.attrs;
  const hiddenIds: ReadonlySet<string> = new Set(
    node.attrs.hiddenProperties ?? []
  );
  const blockFilter: FilterCondition | null = node.attrs.filter ?? null;
  const columnWidths: Record<string, number> = node.attrs.columnWidths ?? {};
  const wrapOverrides: Record<string, boolean> =
    node.attrs.wrappedColumns ?? {};

  const filterKey = JSON.stringify(blockFilter);
  const [rowIds, setRowIds] = React.useState<string[]>();
  const [expandedRowIds, setExpandedRowIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set());
  const database = databaseId ? databases.get(databaseId) : undefined;
  const schema: Property[] = database?.dataSchema ?? [];
  const views: DataView[] = database?.views ?? [];
  // the block reads through one of the database's saved views — the named one,
  // or the first saved view when the block predates it. A database with no
  // saved views at all falls back to a table over every property.
  const view: DataView | undefined = database?.resolveView(viewId);
  const viewType = view?.type ?? DataViewType.Table;
  // the view's own visibility, further narrowed by this embed's own
  // overrides — an embed can hide a column the view shows, but not the other
  // way around (showing one the view itself excludes needs a different view)
  const viewSchema = visiblePropertiesForView(schema, view);
  const visibleSchema = viewSchema.filter(
    (property) => !hiddenIds.has(property.id)
  );

  // a column wraps if this embed says so, and otherwise if the saved view
  // does — the embed's entry is an override, not a replacement
  const wrapsColumn = (columnId: string): boolean =>
    wrapOverrides[columnId] ??
    !!view?.columns.find((column) => column.propertyId === columnId)?.wrap;

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

  React.useEffect(() => {
    if (!databaseId) {
      return;
    }

    async function load() {
      try {
        if (!databases.get(databaseId)) {
          await databases.fetch(databaseId);
        }
        const resolved = databases.get(databaseId)?.resolveView(viewId);
        const { rows: results } = await documents.fetchInDatabase({
          databaseId,
          // this embed's own condition narrows the view's filter rather than
          // replacing it, the same way it can only hide columns the view shows
          filter: combineFilters(resolved?.filter, blockFilter ?? undefined),
          propertySorts: resolved?.sorts?.length ? resolved.sorts : undefined,
          limit: ROW_LIMIT,
        });
        if (isMounted()) {
          setRowIds(results.map((doc: { id: string }) => doc.id));
        }
      } catch (_err) {
        if (isMounted()) {
          setRowIds([]);
        }
      }
    }

    void load();
    // the filter is compared by value: prosemirror hands back a new attrs
    // object whenever the node is re-created, identical contents and all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId, viewId, filterKey, databases, documents, isMounted]);

  if (!databaseId) {
    const available = databases.orderedData;
    return (
      <Container contentEditable={false}>
        <Placeholder>
          {isEditable && available.length > 0 ? (
            <>
              {t("Choose a database")}:{" "}
              {available.map((item: { id: string; name: string }) => (
                <PickerButton
                  key={item.id}
                  type="button"
                  onClick={() => onChangeDatabase(item.id)}
                >
                  {item.name}
                </PickerButton>
              ))}
            </>
          ) : (
            t("No database selected")
          )}
        </Placeholder>
      </Container>
    );
  }

  if (!database) {
    return (
      <Container contentEditable={false}>
        <Placeholder>{t("Database not accessible")}</Placeholder>
      </Container>
    );
  }

  const rows: RowModel[] = (rowIds ?? [])
    .map((id: string) => documents.get(id))
    .filter(Boolean);
  const isEmpty = rowIds !== undefined && rows.length === 0;
  // sub-items are rows parented under another row; table and list views show
  // them indented under their parent, once it is expanded
  const rowTree = buildRowTree(rows, expandedRowIds);

  return (
    <Container contentEditable={false}>
      <Header>
        <Title to={database.path}>{database.name}</Title>
        {isEditable && (views.length > 0 || viewSchema.length > 0) && (
          <HeaderActions>
            {views.length > 0 && (
              <ViewPicker>
                {views.map((item: DataView) => (
                  <PickerButton
                    key={item.id}
                    type="button"
                    onClick={() => onChangeView(item.id)}
                    $active={view?.id === item.id}
                  >
                    {item.name}
                  </PickerButton>
                ))}
              </ViewPicker>
            )}
            {viewSchema.length > 0 && (
              <FilterMenu
                schema={viewSchema}
                filter={blockFilter}
                onChange={onChangeFilter}
              />
            )}
            {viewSchema.length > 0 && (
              <PropertyVisibilityMenu
                schema={viewSchema}
                hiddenIds={hiddenIds}
                onToggle={onToggleProperty}
                titleLabel={t("Title")}
                wrapsColumn={wrapsColumn}
                onToggleWrap={onToggleWrap}
              />
            )}
          </HeaderActions>
        )}
      </Header>
      {viewType === DataViewType.Board ? (
        <BlockBoard
          rows={rows}
          schema={schema}
          properties={visibleSchema}
          view={view}
          isEmpty={isEmpty}
          emptyLabel={t("No documents yet")}
          noValueLabel={t("No value")}
        />
      ) : viewType === DataViewType.List ? (
        <BlockList
          rows={rowTree.visibleRows}
          rowTree={rowTree}
          expandedRowIds={expandedRowIds}
          onToggleRowExpand={handleToggleRowExpand}
          schema={visibleSchema}
          isEmpty={isEmpty}
          emptyLabel={t("No documents yet")}
        />
      ) : viewType === DataViewType.Gallery ? (
        <BlockGallery
          rows={rows}
          schema={visibleSchema}
          isEmpty={isEmpty}
          emptyLabel={t("No documents yet")}
        />
      ) : (
        <BlockTable
          rows={rowTree.visibleRows}
          rowTree={rowTree}
          expandedRowIds={expandedRowIds}
          onToggleRowExpand={handleToggleRowExpand}
          schema={visibleSchema}
          isEmpty={isEmpty}
          emptyLabel={t("No documents yet")}
          titleLabel={t("Title")}
          columnWidths={columnWidths}
          onResizeColumn={isEditable ? onResizeColumn : undefined}
          wrapsColumn={wrapsColumn}
        />
      )}
    </Container>
  );
}

/**
 * A funnel dropdown holding one filter condition applied to THIS embed only,
 * narrowing whatever the saved view already filters. Built from native form
 * controls: this component lives in shared code and cannot reach the app's
 * select or popover.
 */
function FilterMenu({
  schema,
  filter,
  onChange,
}: {
  schema: Property[];
  filter: FilterCondition | null;
  onChange: (filter: FilterCondition | null) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const filterable = schema.filter(
    (property) => filterOperatorsForProperty(property.type).length > 0
  );
  const property = schema.find((item) => item.id === filter?.propertyId);
  const operators = property ? filterOperatorsForProperty(property.type) : [];

  const handleProperty = (propertyId: string) => {
    const next = filterable.find((item) => item.id === propertyId);
    if (!next) {
      onChange(null);
      return;
    }
    const operator = filterOperatorsForProperty(next.type)[0];
    onChange({
      propertyId,
      operator,
      value: defaultFilterValue(next, operator),
    });
  };

  const handleOperator = (value: string) => {
    if (!filter || !property) {
      return;
    }
    const operator = operators.find((item) => item === value);
    if (!operator) {
      return;
    }
    onChange({
      ...filter,
      operator,
      value: isValuelessFilterOperator(operator)
        ? undefined
        : (filter.value ?? defaultFilterValue(property, operator)),
    });
  };

  const handleValue = (value: PropertyValue | undefined) => {
    if (!filter) {
      return;
    }
    onChange({ ...filter, value });
  };

  return (
    <MenuContainer ref={containerRef}>
      <MenuTrigger
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={t("Filter")}
        aria-expanded={isOpen}
        $active={!!filter}
      >
        <FunnelIcon />
      </MenuTrigger>
      {isOpen && (
        <MenuContent>
          <FilterRow>
            <FilterSelect
              value={filter?.propertyId ?? ""}
              onChange={(event) => handleProperty(event.target.value)}
              aria-label={t("Filter by")}
            >
              <option value="">{t("No filter")}</option>
              {filterable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </FilterSelect>
          </FilterRow>
          {filter && property && (
            <>
              <FilterRow>
                <FilterSelect
                  value={filter.operator}
                  onChange={(event) => handleOperator(event.target.value)}
                  aria-label={t("Operator")}
                >
                  {operators.map((operator) => (
                    <option key={operator} value={operator}>
                      {t(filterOperatorLabels[operator])}
                    </option>
                  ))}
                </FilterSelect>
              </FilterRow>
              {!isValuelessFilterOperator(filter.operator) && (
                <FilterRow>
                  <FilterValueInput
                    property={property}
                    value={filter.value}
                    onChange={handleValue}
                  />
                </FilterRow>
              )}
              <FilterRow>
                <ClearButton type="button" onClick={() => onChange(null)}>
                  {t("Clear")}
                </ClearButton>
              </FilterRow>
            </>
          )}
        </MenuContent>
      )}
    </MenuContainer>
  );
}

/** The control for a filter's comparison value, chosen by property type. */
function FilterValueInput({
  property,
  value,
  onChange,
}: {
  property: Property;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue | undefined) => void;
}) {
  const { t } = useTranslation();

  switch (property.type) {
    case PropertyType.Select:
    case PropertyType.MultiSelect:
      return (
        <FilterSelect
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
          aria-label={t("Value")}
        >
          <option value="">{t("Value")}</option>
          {(property.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </FilterSelect>
      );

    case PropertyType.Checkbox:
      return (
        <FilterSelect
          value={value === false ? "false" : "true"}
          onChange={(event) => onChange(event.target.value === "true")}
          aria-label={t("Value")}
        >
          <option value="true">{t("Checked")}</option>
          <option value="false">{t("Unchecked")}</option>
        </FilterSelect>
      );

    case PropertyType.Number:
      return (
        <FilterInput
          type="number"
          defaultValue={typeof value === "number" ? String(value) : ""}
          placeholder={t("Value")}
          onBlur={(event) => {
            const parsed = Number(event.target.value);
            onChange(Number.isFinite(parsed) ? parsed : undefined);
          }}
        />
      );

    case PropertyType.Date:
      return (
        <FilterInput
          type="date"
          defaultValue={typeof value === "string" ? value.slice(0, 10) : ""}
          onBlur={(event) => onChange(event.target.value || undefined)}
        />
      );

    default:
      return (
        <FilterInput
          type="text"
          defaultValue={typeof value === "string" ? value : ""}
          placeholder={t("Value")}
          onBlur={(event) => onChange(event.target.value || undefined)}
        />
      );
  }
}

/** A funnel glyph, as outline-icons has no filter icon. */
function FunnelIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.5 6h13a1 1 0 0 1 .8 1.6L14 14v4.6a1 1 0 0 1-1.4.9l-2-.9a1 1 0 0 1-.6-.9V14L4.7 7.6A1 1 0 0 1 5.5 6z" />
    </svg>
  );
}

/**
 * An eye-icon dropdown listing the properties this embed's view would show,
 * with a checkmark for the ones actually visible here — toggling one hides
 * or reveals it in THIS embed only, leaving the saved view and every other
 * embed of the same database untouched. Self-contained (no portal) since
 * this component lives in shared code and cannot use the app's Popover.
 */
function PropertyVisibilityMenu({
  schema,
  hiddenIds,
  onToggle,
  titleLabel,
  wrapsColumn,
  onToggleWrap,
}: {
  schema: Property[];
  hiddenIds: ReadonlySet<string>;
  onToggle: (propertyId: string) => void;
  titleLabel: string;
  wrapsColumn: (columnId: string) => boolean;
  onToggleWrap: (columnId: string, wrap: boolean | null) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  return (
    <MenuContainer ref={containerRef}>
      <MenuTrigger
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={t("Visible properties")}
        aria-expanded={isOpen}
      >
        <EyeIcon size={18} />
      </MenuTrigger>
      {isOpen && (
        <MenuContent role="menu">
          <MenuSectionLabel>{t("Visible")}</MenuSectionLabel>
          {schema.map((property) => (
            <MenuRow
              key={property.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={!hiddenIds.has(property.id)}
              onClick={() => onToggle(property.id)}
            >
              <MenuLabel>{property.name}</MenuLabel>
              {!hiddenIds.has(property.id) && <CheckmarkIcon size={16} />}
            </MenuRow>
          ))}
          <MenuDivider />
          <MenuSectionLabel>{t("Wrap text")}</MenuSectionLabel>
          {[
            { id: TITLE_COLUMN_ID, name: titleLabel },
            ...schema.filter((property) => !hiddenIds.has(property.id)),
          ].map((column) => (
            <MenuRow
              key={`wrap-${column.id}`}
              type="button"
              role="menuitemcheckbox"
              aria-checked={wrapsColumn(column.id)}
              onClick={() => onToggleWrap(column.id, !wrapsColumn(column.id))}
            >
              <MenuLabel>{column.name}</MenuLabel>
              {wrapsColumn(column.id) && <CheckmarkIcon size={16} />}
            </MenuRow>
          ))}
        </MenuContent>
      )}
    </MenuContainer>
  );
}

/**
 * The arrow that opens and closes a row's sub-items. Rows without sub-items
 * keep an empty slot of the same width, so titles stay aligned down the
 * column, and nothing is rendered at all when no row in view nests.
 */
function Disclosure({
  row,
  rowTree,
  expandedRowIds,
  onToggleRowExpand,
}: {
  row: RowModel;
  rowTree: RowTree<RowModel>;
  expandedRowIds: ReadonlySet<string>;
  onToggleRowExpand: (rowId: string) => void;
}) {
  const { t } = useTranslation();

  if (!rowTree.hasNesting) {
    return null;
  }
  if (!rowTree.parentIds.has(row.id)) {
    return <DisclosureSpacer />;
  }

  const isExpanded = expandedRowIds.has(row.id);
  return (
    <DisclosureButton
      type="button"
      onClick={() => onToggleRowExpand(row.id)}
      aria-expanded={isExpanded}
      aria-label={isExpanded ? t("Collapse") : t("Expand")}
      $expanded={isExpanded}
    >
      <CollapsedIcon size={18} />
    </DisclosureButton>
  );
}

const BlockTable = observer(function BlockTable_({
  rows,
  rowTree,
  expandedRowIds,
  onToggleRowExpand,
  schema,
  isEmpty,
  emptyLabel,
  titleLabel,
  columnWidths,
  onResizeColumn,
  wrapsColumn,
}: {
  rows: RowModel[];
  rowTree: RowTree<RowModel>;
  expandedRowIds: ReadonlySet<string>;
  onToggleRowExpand: (rowId: string) => void;
  schema: Property[];
  isEmpty: boolean;
  emptyLabel: string;
  titleLabel: string;
  columnWidths: Record<string, number>;
  onResizeColumn?: (columnId: string, width: number) => void;
  wrapsColumn: (columnId: string) => boolean;
}) {
  // a drag previews locally and is written to the node once, on release, so
  // that a resize is one undo step rather than one per pointer move
  const [draftWidths, setDraftWidths] = React.useState<Record<string, number>>(
    {}
  );

  const handleDraft = React.useCallback((columnId: string, width: number) => {
    setDraftWidths((current) => ({ ...current, [columnId]: width }));
  }, []);

  const handleCommit = React.useCallback(
    (columnId: string, width: number) => {
      setDraftWidths((current) => {
        const { [columnId]: _dropped, ...rest } = current;
        return rest;
      });
      onResizeColumn?.(columnId, width);
    },
    [onResizeColumn]
  );

  const widthFor = (columnId: string) =>
    draftWidths[columnId] ?? columnWidths[columnId];

  return (
    <ScrollContainer>
      <Grid>
        <thead>
          <tr>
            <HeaderCell
              $minWidth={180}
              $resizable={!!onResizeColumn}
              style={columnWidthStyle(widthFor(TITLE_COLUMN_ID))}
            >
              {titleLabel}
              {onResizeColumn && (
                <ColumnResizeHandle
                  columnId={TITLE_COLUMN_ID}
                  onDraft={handleDraft}
                  onCommit={handleCommit}
                />
              )}
            </HeaderCell>
            {schema.map((property) => (
              <HeaderCell
                key={property.id}
                $resizable={!!onResizeColumn}
                style={columnWidthStyle(widthFor(property.id))}
              >
                {property.name}
                {onResizeColumn && (
                  <ColumnResizeHandle
                    columnId={property.id}
                    onDraft={handleDraft}
                    onCommit={handleCommit}
                  />
                )}
              </HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((doc) => (
            <tr key={doc.id}>
              <Cell
                $wrap={wrapsColumn(TITLE_COLUMN_ID)}
                style={columnWidthStyle(widthFor(TITLE_COLUMN_ID))}
              >
                <TitleContent
                  style={{
                    paddingLeft:
                      (rowTree.depthById.get(doc.id) ?? 0) * INDENT_WIDTH,
                  }}
                >
                  <Disclosure
                    row={doc}
                    rowTree={rowTree}
                    expandedRowIds={expandedRowIds}
                    onToggleRowExpand={onToggleRowExpand}
                  />
                  <RowLink to={doc.path}>{doc.titleWithDefault}</RowLink>
                </TitleContent>
              </Cell>
              {schema.map((property) => (
                <Cell
                  key={property.id}
                  $wrap={wrapsColumn(property.id)}
                  style={columnWidthStyle(widthFor(property.id))}
                >
                  <PropertyValueLabel
                    property={property}
                    value={doc.propertyValue(property.id)}
                  />
                </Cell>
              ))}
            </tr>
          ))}
          {isEmpty && (
            <tr>
              <EmptyCell colSpan={schema.length + 1}>{emptyLabel}</EmptyCell>
            </tr>
          )}
        </tbody>
      </Grid>
    </ScrollContainer>
  );
});

/** The width every column in an embed may be dragged down to, but not below. */
const MIN_COLUMN_WIDTH = 60;

function columnWidthStyle(width?: number): React.CSSProperties | undefined {
  return width ? { width, minWidth: width, maxWidth: width } : undefined;
}

/**
 * The draggable right edge of a header cell in an embedded table. Dragging
 * previews the width locally and writes it to the block once the pointer is
 * released, where it applies to this embed alone.
 */
function ColumnResizeHandle({
  columnId,
  onDraft,
  onCommit,
}: {
  columnId: string;
  onDraft: (columnId: string, width: number) => void;
  onCommit: (columnId: string, width: number) => void;
}) {
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const cell = handle.closest("th");
    if (!cell) {
      return;
    }
    const startX = event.clientX;
    const startWidth = cell.getBoundingClientRect().width;
    let width = Math.round(startWidth);

    const handleMove = (moveEvent: PointerEvent) => {
      width = Math.max(
        MIN_COLUMN_WIDTH,
        Math.round(startWidth + moveEvent.clientX - startX)
      );
      onDraft(columnId, width);
    };
    const handleUp = () => {
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      handle.removeEventListener("pointercancel", handleUp);
      onCommit(columnId, width);
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
    handle.addEventListener("pointercancel", handleUp);
  };

  return <ResizeGrip onPointerDown={handlePointerDown} aria-hidden />;
}

const BlockBoard = observer(function BlockBoard_({
  rows,
  schema,
  properties,
  view,
  isEmpty,
  emptyLabel,
  noValueLabel,
}: {
  rows: RowModel[];
  schema: Property[];
  properties: Property[];
  view?: DataView;
  isEmpty: boolean;
  emptyLabel: string;
  noValueLabel: string;
}) {
  const configured = view?.groupBy
    ? schema.find((item) => item.id === view.groupBy)
    : undefined;
  const property =
    configured && isGroupableProperty(configured)
      ? configured
      : schema.find(isGroupableProperty);

  if (!property) {
    return <Placeholder>{emptyLabel}</Placeholder>;
  }
  if (isEmpty) {
    return <Placeholder>{emptyLabel}</Placeholder>;
  }

  const groups = groupByProperty(rows, property, (doc) =>
    doc.propertyValue(property.id)
  );
  const cardProperties = properties.filter((item) => item.id !== property.id);

  return (
    <ScrollContainer>
      <Columns>
        {groups.map((group) => (
          <Column key={group.option?.id ?? "none"}>
            <ColumnHeader>
              {group.option ? (
                <PropertyChip $color={group.option.color}>
                  {group.option.name}
                </PropertyChip>
              ) : (
                <MutedLabel>{noValueLabel}</MutedLabel>
              )}
              <MutedLabel>{group.items.length}</MutedLabel>
            </ColumnHeader>
            {group.items.map((doc) => (
              <BoardCard key={doc.id}>
                <RowLink to={doc.path}>{doc.titleWithDefault}</RowLink>
                {cardProperties.map((item) => {
                  const value = doc.propertyValue(item.id);
                  if (value === undefined || value === null) {
                    return null;
                  }
                  return (
                    <CardValue key={item.id}>
                      <PropertyValueLabel property={item} value={value} />
                    </CardValue>
                  );
                })}
              </BoardCard>
            ))}
          </Column>
        ))}
      </Columns>
    </ScrollContainer>
  );
});

const BlockList = observer(function BlockList_({
  rows,
  rowTree,
  expandedRowIds,
  onToggleRowExpand,
  schema,
  isEmpty,
  emptyLabel,
}: {
  rows: RowModel[];
  rowTree: RowTree<RowModel>;
  expandedRowIds: ReadonlySet<string>;
  onToggleRowExpand: (rowId: string) => void;
  schema: Property[];
  isEmpty: boolean;
  emptyLabel: string;
}) {
  if (isEmpty) {
    return <Placeholder>{emptyLabel}</Placeholder>;
  }
  return (
    <div>
      {rows.map((doc) => (
        <ListRow
          key={doc.id}
          style={{
            paddingLeft:
              10 + (rowTree.depthById.get(doc.id) ?? 0) * INDENT_WIDTH,
          }}
        >
          <Disclosure
            row={doc}
            rowTree={rowTree}
            expandedRowIds={expandedRowIds}
            onToggleRowExpand={onToggleRowExpand}
          />
          <RowLink to={doc.path}>{doc.titleWithDefault}</RowLink>
          <ListValues>
            {schema.map((property) => {
              const value = doc.propertyValue(property.id);
              if (value === undefined || value === null) {
                return null;
              }
              return (
                <span key={property.id}>
                  <PropertyValueLabel property={property} value={value} />
                </span>
              );
            })}
          </ListValues>
        </ListRow>
      ))}
    </div>
  );
});

const BlockGallery = observer(function BlockGallery_({
  rows,
  schema,
  isEmpty,
  emptyLabel,
}: {
  rows: RowModel[];
  schema: Property[];
  isEmpty: boolean;
  emptyLabel: string;
}) {
  if (isEmpty) {
    return <Placeholder>{emptyLabel}</Placeholder>;
  }
  return (
    <GalleryGrid>
      {rows.map((doc) => (
        <GalleryCard key={doc.id}>
          <RowLink to={doc.path}>{doc.titleWithDefault}</RowLink>
          {schema.map((property) => {
            const value = doc.propertyValue(property.id);
            if (value === undefined || value === null) {
              return null;
            }
            return (
              <CardValue key={property.id}>
                <MutedLabel>{property.name}</MutedLabel>{" "}
                <PropertyValueLabel property={property} value={value} />
              </CardValue>
            );
          })}
        </GalleryCard>
      ))}
    </GalleryGrid>
  );
});

const Container = styled.div`
  margin: 8px 0;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-bottom: 1px solid ${s("divider")};
`;

const Title = styled(Link)`
  font-weight: 500;
  color: ${s("text")};
`;

const HeaderActions = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const ViewPicker = styled.span`
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
`;

const MenuContainer = styled.div`
  position: relative;
  display: inline-flex;
`;

const MenuTrigger = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: ${(props) =>
    props.$active ? props.theme.accent : props.theme.textSecondary};
  cursor: var(--pointer);

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${(props) =>
      props.$active ? props.theme.accent : props.theme.text};
  }
`;

const MenuContent = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 1;
  min-width: 180px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  background: ${s("menuBackground")};
  border-radius: 6px;
  box-shadow: ${s("menuShadow")};
`;

const MenuSectionLabel = styled.div`
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${s("textTertiary")};
`;

const MenuDivider = styled.hr`
  border: 0;
  border-top: 1px solid ${s("divider")};
  margin: 4px 0;
`;

const FilterRow = styled.div`
  padding: 4px;
`;

const FilterSelect = styled.select`
  width: 100%;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid ${s("inputBorder")};
  background: ${s("background")};
  color: ${s("text")};
`;

const FilterInput = styled.input`
  width: 100%;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid ${s("inputBorder")};
  background: ${s("background")};
  color: ${s("text")};
  outline: none;

  &:focus {
    border-color: ${s("inputBorderFocused")};
  }
`;

const ClearButton = styled.button`
  width: 100%;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 0;
  background: none;
  color: ${s("textSecondary")};
  cursor: var(--pointer);
  text-align: left;

  &:hover {
    background: ${s("listItemHoverBackground")};
    color: ${s("text")};
  }
`;

const MenuRow = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: none;
  padding: 6px 8px;
  border-radius: 4px;
  color: ${s("text")};
  font-size: 14px;
  cursor: var(--pointer);
  text-align: left;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const MenuLabel = styled.span`
  flex-grow: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ScrollContainer = styled.div`
  overflow-x: auto;
`;

const Grid = styled.table`
  border-collapse: collapse;
  width: 100%;
  /* column widths come from the header row alone, so a long value cannot stop
     a column from being dragged narrow; columns with no width of their own
     share what is left */
  table-layout: fixed;
  font-size: 14px;
`;

const HeaderCell = styled.th<{ $minWidth?: number; $resizable?: boolean }>`
  position: ${(props) => (props.$resizable ? "relative" : "static")};
  text-align: left;
  font-weight: 500;
  color: ${s("textSecondary")};
  padding: 6px 10px;
  border-bottom: 1px solid ${s("divider")};
  white-space: nowrap;
  min-width: ${(props) => props.$minWidth ?? 120}px;

  &:not(:last-child) {
    border-right: 1px solid ${s("divider")};
  }
`;

const ResizeGrip = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 2;
  touch-action: none;

  &:hover,
  &:active {
    background: ${s("accent")};
    opacity: 0.5;
  }
`;

const Cell = styled.td<{ $wrap?: boolean }>`
  padding: 6px 10px;
  vertical-align: middle;
  /* the table lays columns out from the header row, so a value has to be
     clipped or wrapped rather than push its column wider */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: ${(props) => (props.$wrap ? "pre-wrap" : "nowrap")};
  overflow-wrap: ${(props) => (props.$wrap ? "anywhere" : "normal")};

  &:not(:last-child) {
    border-right: 1px solid ${s("divider")};
  }

  tr:not(:last-child) & {
    border-bottom: 1px solid ${s("divider")};
  }
`;

const TitleContent = styled.div`
  display: flex;
  align-items: center;
`;

const DisclosureSpacer = styled.span`
  flex-shrink: 0;
  width: 20px;
`;

const DisclosureButton = styled.button<{ $expanded: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: none;
  cursor: var(--pointer);
  color: ${s("textSecondary")};

  svg {
    transition: transform 100ms ease;
    transform: rotate(${(props) => (props.$expanded ? "0deg" : "-90deg")});
  }

  &:hover {
    color: ${s("text")};
  }
`;

const RowLink = styled(Link)`
  display: inline-block;
  color: ${s("text")};

  &:hover {
    text-decoration: underline;
  }
`;

const Columns = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
`;

const Column = styled.div`
  flex: 0 0 200px;
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  padding: 6px;
`;

const ColumnHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
`;

const BoardCard = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;

  &:not(:last-child) {
    margin-bottom: 6px;
  }
`;

const CardValue = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ListRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  font-size: 14px;

  &:not(:last-child) {
    border-bottom: 1px solid ${s("divider")};
  }
`;

const ListValues = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: ${s("textSecondary")};
`;

const GalleryGrid = styled.div`
  display: grid;
  gap: 8px;
  padding: 8px;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
`;

const GalleryCard = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 14px;
`;

const MutedLabel = styled.span`
  color: ${s("textSecondary")};
  font-size: 12px;
`;

const EmptyCell = styled.td`
  padding: 16px;
  text-align: center;
  color: ${s("textSecondary")};
`;

const Placeholder = styled.div`
  padding: 16px;
  color: ${s("textSecondary")};
`;

const PickerButton = styled.button<{ $active?: boolean }>`
  border: 1px solid ${(props) => props.theme.inputBorder};
  background: ${(props) =>
    props.$active ? props.theme.backgroundSecondary : "none"};
  color: ${s("text")};
  border-radius: 12px;
  padding: 2px 10px;
  margin: 0 4px 4px 0;
  font-size: 13px;
  cursor: var(--pointer);
`;

export default observer(DatabaseBlock);
