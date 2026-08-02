import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { TeamPreference } from "@shared/types";
import type Document from "~/models/Document";
import DatabaseView from "~/scenes/Database/components/DatabaseView";
import useStores from "~/hooks/useStores";

type Props = {
  /** The document whose anchored database to render, if it has one. */
  document: Document;
};

/**
 * Renders the database anchored to a document underneath its body: the
 * saved-view tabs, the toolbar and the rows. A document is a database when a
 * database facet shares its id; for ordinary documents nothing is rendered.
 */
function DocumentDatabase({ document }: Props) {
  const { auth, databases } = useStores();
  const enabled = !!auth.team?.getPreference(TeamPreference.DocumentDatabases);

  // the sidebar usually loads all databases already; this covers direct
  // navigation paths where it has not run yet
  React.useEffect(() => {
    if (enabled && !databases.isLoaded && !databases.isFetching) {
      void databases.fetchAll();
    }
  }, [enabled, databases]);

  const database = enabled ? databases.get(document.id) : undefined;
  if (!database) {
    return null;
  }

  return (
    <Section>
      <DatabaseView database={database} />
    </Section>
  );
}

const Section = styled.div`
  margin: 12px 0;

  @media print {
    break-inside: avoid;
  }
`;

export default observer(DocumentDatabase);
