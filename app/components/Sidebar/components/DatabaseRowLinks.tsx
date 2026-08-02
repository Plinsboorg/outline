import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useHistory, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import Icon from "@shared/components/Icon";
import type Database from "~/models/Database";
import Fade from "~/components/Fade";
import Text from "~/components/Text";
import DatabaseRowMenu from "~/scenes/Database/components/DatabaseRowMenu";
import useDeleteRow from "~/hooks/useDeleteRow";
import useStores from "~/hooks/useStores";
import SidebarLink from "./SidebarLink";

type Props = {
  /** The database whose rows to list. */
  database: Database;
  /** The nesting depth to render the rows at. */
  depth: number;
};

/** The most rows listed under a database in the sidebar. */
const MAX_SIDEBAR_ROWS = 25;

/**
 * The rows of a database, listed in the sidebar under the database's own
 * document link, capped so a large database cannot flood the sidebar.
 */
function DatabaseRowLinks({ database, depth }: Props) {
  const { t } = useTranslation();
  const { documents } = useStores();
  const history = useHistory();
  const location = useLocation();
  const handleDeleteRow = useDeleteRow();

  const rows = documents.inDatabase(database.id);

  React.useEffect(() => {
    void documents
      .fetchInDatabase({ databaseId: database.id, limit: MAX_SIDEBAR_ROWS })
      .catch((error) => toast.error(errToString(error)));
  }, [documents, database.id]);

  return (
    <>
      {rows.map((row) => (
        <SidebarLink
          key={row.id}
          to={row.path}
          icon={
            row.icon ? (
              <Icon
                value={row.icon}
                color={row.color ?? undefined}
                initial={row.titleWithDefault[0]}
              />
            ) : undefined
          }
          label={row.titleWithDefault}
          depth={depth}
          isActive={() => location.pathname === row.path}
          menu={
            <Fade>
              <DatabaseRowMenu document={row} onDelete={handleDeleteRow} />
            </Fade>
          }
        />
      ))}
      {rows.length === 0 && (
        <SidebarLink
          label={
            <Text type="tertiary" size="small" italic>
              {t("Empty")}
            </Text>
          }
          depth={depth}
        />
      )}
      {rows.length >= MAX_SIDEBAR_ROWS && (
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

export default observer(DatabaseRowLinks);
