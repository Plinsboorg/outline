import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import type { DatabaseBlockProps } from "@shared/editor/nodes/DatabaseBlock";
import { s } from "@shared/styles";
import type { DataViewOverride } from "@shared/types";
import type Database from "~/models/Database";
import DatabaseView from "~/scenes/Database/components/DatabaseView";
import { useOverriddenViewSource } from "~/scenes/Database/hooks/useDatabaseViewSource";
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
}: DatabaseBlockProps) {
  const { t } = useTranslation();
  const { databases } = useStores();
  const { databaseId, viewId } = node.attrs;
  const override: DataViewOverride | null = node.attrs.viewOverride ?? null;

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
      isEditable={isEditable}
      onChangeView={onChangeView}
      onChangeViewOverride={onChangeViewOverride}
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
  /** Whether the host document can be edited, and so the embed configured. */
  isEditable: boolean;
  /** Callback reading through a different saved view. */
  onChangeView: (viewId: string | null) => void;
  /** Callback storing a changed override on the node. */
  onChangeViewOverride: (override: DataViewOverride | null) => void;
};

/**
 * A database rendered through an override belonging to the block it is
 * embedded in.
 */
const EmbeddedDatabase = observer(function EmbeddedDatabase_({
  database,
  viewId,
  override,
  isEditable,
  onChangeView,
  onChangeViewOverride,
}: EmbeddedProps) {
  // configuring an embed writes to the host document, so it follows whether
  // that document is editable rather than the database's own policy
  const handleSelectView = React.useCallback(
    (id: string) => {
      if (isEditable) {
        onChangeView(id);
      }
    },
    [isEditable, onChangeView]
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
    database,
    viewId,
    override,
    onSelectView: handleSelectView,
    onChangeOverride: handleChangeOverride,
  });

  return (
    <Container contentEditable={false}>
      <Header>
        <Title to={database.path}>{database.name}</Title>
      </Header>
      <Body>
        <DatabaseView
          database={database}
          source={source}
          pageSize={ROW_LIMIT}
          canEditView={isEditable}
        />
      </Body>
    </Container>
  );
});

const Container = styled.div`
  margin: 8px 0;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
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

const Body = styled.div`
  /* the table brings its own horizontal scroll container */
  padding: 0 10px 8px;
`;

const Placeholder = styled.div`
  padding: 16px;
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
