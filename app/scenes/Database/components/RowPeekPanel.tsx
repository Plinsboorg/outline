import { observer } from "mobx-react";
import { CloseIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import type Document from "~/models/Document";
import DocumentProperties from "~/components/DocumentProperties";
import NudeButton from "~/components/NudeButton";
import { fadeInAndSlideLeft } from "~/styles/animations";

interface Props {
  /** The row document to display in the panel. */
  document: Document;
  /** Callback to close the panel. */
  onClose: () => void;
}

/**
 * A slide-in panel on the right side of the database view that shows a row's
 * title and properties without navigating away from the database. Closes on
 * Escape or when the backdrop is clicked.
 */
function RowPeekPanel({ document, onClose }: Props) {
  const { t } = useTranslation();

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <Backdrop onClick={onClose}>
      <Panel onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>{document.titleWithDefault}</Title>
          <Actions>
            <OpenFullPage to={document.path}>
              {t("Open full page")} →
            </OpenFullPage>
            <NudeButton onClick={onClose} aria-label={t("Close")}>
              <CloseIcon size={20} />
            </NudeButton>
          </Actions>
        </Header>
        <Body>
          <DocumentProperties document={document} />
        </Body>
      </Panel>
    </Backdrop>
  );
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 100;
  background: transparent;
`;

const Panel = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 90vw;
  background: ${s("background")};
  border-left: 1px solid ${s("divider")};
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ${fadeInAndSlideLeft} 150ms ease-out;
  z-index: 101;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid ${s("divider")};
  flex-shrink: 0;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: ${s("text")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const OpenFullPage = styled(Link)`
  font-size: 13px;
  color: ${s("textSecondary")};
  white-space: nowrap;

  &:hover {
    color: ${s("text")};
    text-decoration: underline;
  }
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
`;

export default observer(RowPeekPanel);
