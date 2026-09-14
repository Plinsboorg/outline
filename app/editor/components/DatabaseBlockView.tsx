import { observer } from "mobx-react";
import { SettingsIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import type { DatabaseBlockProps } from "@shared/editor/nodes/DatabaseBlock";
import { s } from "@shared/styles";
import type { DataView, DataViewOverride } from "@shared/types";
import type Database from "~/models/Database";
import DatabaseView from "~/scenes/Database/components/DatabaseView";
import { useOverriddenViewSource } from "~/scenes/Database/hooks/useDatabaseViewSource";
import NudeButton from "~/components/NudeButton";
import Switch from "~/components/Switch";
import Tooltip from "~/components/Tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/primitives/Popover";
import useStores from "~/hooks/useStores";

/** How many rows an embedded database loads before asking for more. */
const ROW_LIMIT = 25;

/**
 * Renders the `database` node: the rows of a database, live and editable,
 * inline in another document.
 *
 * This is the same component the database's own page renders, reading through
 * an override stored on the node — so an embed has every feature the page
 * has, while its filter, sorting, grouping and columns belong to this one
 * embed rather than to the saved view it reads. Registered as the node's
 * component from the app, since the node itself lives in shared code that
 * cannot reach app UI.
 */
function DatabaseBlockView({
  node,
  isEditable,
  onChangeDatabase,
  onChangeView,
  onChangeViewOverride,
  onChangeReadOnly,
  onChangeViewIds,
}: DatabaseBlockProps) {
  const { t } = useTranslation();
  const { databases } = useStores();
  const { databaseId, viewId } = node.attrs;
  const override: DataViewOverride | null = node.attrs.viewOverride ?? null;
  const readOnly: boolean = !!node.attrs.readOnly;
  const viewIds: string[] = node.attrs.viewIds ?? [];

  // an embed can be the first thing on a page to mention its database, before
  // the sidebar has loaded them all
  React.useEffect(() => {
    if (databaseId && !databases.get(databaseId) && !databases.isFetching) {
      void databases.fetch(databaseId);
    }
  }, [databaseId, databases]);

  const database = databaseId ? databases.get(databaseId) : undefined;

  if (!databaseId) {
    const available = databases.orderedData;
    return (
      <Container contentEditable={false}>
        <Placeholder>
          {isEditable && available.length > 0 ? (
            <>
              {t("Choose a database")}:{" "}
              {available.map((item) => (
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

  return (
    <EmbeddedDatabase
      database={database}
      viewId={viewId}
      override={override}
      readOnly={readOnly}
      viewIds={viewIds}
      isEditable={isEditable}
      onChangeView={onChangeView}
      onChangeViewOverride={onChangeViewOverride}
      onChangeReadOnly={onChangeReadOnly}
      onChangeViewIds={onChangeViewIds}
    />
  );
}

type EmbeddedProps = {
  /** The database to render. */
  database: Database;
  /** The saved view this embed reads through. */
  viewId: string | null;
  /** How this embed's rendering differs from that view. */
  override: DataViewOverride | null;
  /** Whether the database is shown here without any way to change it. */
  readOnly: boolean;
  /** The views this embed offers; empty offers all of the database's. */
  viewIds: string[];
  /** Whether the host document can be edited, and so the embed configured. */
  isEditable: boolean;
  /** Callback reading through a different saved view. */
  onChangeView: (viewId: string | null) => void;
  /** Callback storing a changed override on the node. */
  onChangeViewOverride: (override: DataViewOverride | null) => void;
  /** Callback protecting the embed from editing, or releasing it. */
  onChangeReadOnly: (readOnly: boolean) => void;
  /** Callback setting which views this embed offers. */
  onChangeViewIds: (viewIds: string[]) => void;
};

/**
 * A database rendered through an override belonging to the block it is
 * embedded in.
 */
const EmbeddedDatabase = observer(function EmbeddedDatabase_({
  database,
  viewId,
  override,
  readOnly,
  viewIds,
  isEditable,
  onChangeView,
  onChangeViewOverride,
  onChangeReadOnly,
  onChangeViewIds,
}: EmbeddedProps) {
  const savedViews = database.views ?? [];
  // an embed can offer a few of the database's views rather than all of them;
  // an empty list follows the database, so views added later show up too
  const offeredViews = viewIds.length
    ? savedViews.filter((view) => viewIds.includes(view.id))
    : savedViews;
  const views = offeredViews.length ? offeredViews : savedViews;

  // configuring an embed writes to the host document, so it follows whether
  // that document is editable rather than the database's own policy
  const handleSelectView = React.useCallback(
    (id: string) => {
      if (!isEditable) {
        return;
      }
      onChangeView(id);
      // a view chosen here is a view this embed offers — selecting one it was
      // not offering, such as a view just created, adds it to the list
      if (viewIds.length && !viewIds.includes(id)) {
        onChangeViewIds([...viewIds, id]);
      }
    },
    [isEditable, onChangeView, onChangeViewIds, viewIds]
  );

  const handleChangeOverride = React.useCallback(
    (next: DataViewOverride | null) => {
      if (isEditable) {
        onChangeViewOverride(next);
      }
    },
    [isEditable, onChangeViewOverride]
  );

  const source = useOverriddenViewSource({
    views,
    viewId,
    override,
    onSelectView: handleSelectView,
    onChangeOverride: handleChangeOverride,
  });

  return (
    <Container contentEditable={false}>
      <Header>
        <Title to={database.path}>{database.name}</Title>
        {isEditable && (
          <EmbedSettings
            readOnly={readOnly}
            views={savedViews}
            viewIds={viewIds}
            onChangeReadOnly={onChangeReadOnly}
            onChangeViewIds={onChangeViewIds}
          />
        )}
      </Header>
      <DatabaseView
        database={database}
        source={source}
        pageSize={ROW_LIMIT}
        canEditView={isEditable && !readOnly}
        readOnly={readOnly}
      />
    </Container>
  );
});

/**
 * The settings that belong to one embed of a database rather than to the
 * database: whether it can be edited through, and which of the database's
 * saved views it offers.
 */
function EmbedSettings({
  readOnly,
  views,
  viewIds,
  onChangeReadOnly,
  onChangeViewIds,
}: {
  readOnly: boolean;
  views: DataView[];
  viewIds: string[];
  onChangeReadOnly: (readOnly: boolean) => void;
  onChangeViewIds: (viewIds: string[]) => void;
}) {
  const { t } = useTranslation();
  // an empty list means every view, so each is shown as offered
  const offered = (viewId: string) =>
    viewIds.length === 0 || viewIds.includes(viewId);

  const handleToggleView = (viewId: string, checked: boolean) => {
    const next = views
      .map((view) => view.id)
      .filter((id) => (id === viewId ? checked : offered(id)));
    if (next.length === 0) {
      // an embed with no views to offer has nothing to render, so the last
      // one cannot be taken away
      return;
    }
    // offering all of them again is stored as offering none in particular,
    // which keeps following the database as views are added
    onChangeViewIds(next.length === views.length ? [] : next);
  };

  return (
    <Popover>
      <Tooltip content={t("Embed settings")}>
        <PopoverTrigger>
          <IconButton type="button" aria-label={t("Embed settings")} size={24}>
            <SettingsIcon size={18} />
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="end"
        aria-label={t("Embed settings")}
        width={240}
        shrink
      >
        <Content>
          <PanelRow>
            <Switch
              label={t("Protect from editing")}
              note={t("Show the database here without any way to change it")}
              labelPosition="right"
              checked={readOnly}
              onChange={onChangeReadOnly}
              inForm={false}
            />
          </PanelRow>
          {views.length > 1 && (
            <>
              <Divider />
              <SectionLabel>{t("Views shown here")}</SectionLabel>
              {views.map((view) => (
                <PanelRow key={view.id}>
                  <Switch
                    label={view.name}
                    labelPosition="right"
                    checked={offered(view.id)}
                    onChange={(checked) => handleToggleView(view.id, checked)}
                    inForm={false}
                  />
                </PanelRow>
              ))}
            </>
          )}
        </Content>
      </PopoverContent>
    </Popover>
  );
}

const Container = styled.div`
  margin: 8px 0;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0;
`;

const Title = styled(Link)`
  font-weight: 500;
  color: ${s("text")};
`;

/**
 * The states with no table to show still need an outline to read as a block
 * of the document — the rendered database does not, since its own rules give
 * it a shape.
 */
const IconButton = styled(NudeButton)`
  color: ${s("textSecondary")};
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
  }
`;

const Content = styled.div`
  padding: 2px 12px;
`;

const PanelRow = styled.div`
  padding: 4px 0;
`;

const SectionLabel = styled.div`
  padding: 4px 0;
  font-size: 12px;
  font-weight: 500;
  color: ${s("textTertiary")};
`;

const Divider = styled.hr`
  border: 0;
  border-top: 1px solid ${s("divider")};
  margin: 6px 0;
`;

const Placeholder = styled.div`
  padding: 16px;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  color: ${s("textSecondary")};
`;

const PickerButton = styled.button`
  border: 1px solid ${(props) => props.theme.inputBorder};
  background: none;
  color: ${s("text")};
  border-radius: 12px;
  padding: 2px 10px;
  margin: 0 4px 4px 0;
  font-size: 13px;
  cursor: var(--pointer);
`;

export default observer(DatabaseBlockView);
