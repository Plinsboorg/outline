import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import Icon from "@shared/components/Icon";
import { s } from "@shared/styles";
import { errToString } from "@shared/utils/error";
import { DocumentValidation } from "@shared/validations";
import type Document from "~/models/Document";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";

type Props = {
  /** The database's anchor document whose title to show. */
  document: Document;
};

/**
 * The compact heading of a database's page: the document's icon and title
 * with click-to-rename. It stands in for the document editor — a database
 * page shows its views rather than a text body.
 */
function DatabaseDocumentTitle({ document }: Props) {
  const { t } = useTranslation();
  const { documents } = useStores();
  const can = usePolicy(document);
  const [isEditing, setIsEditing] = React.useState(false);
  const [value, setValue] = React.useState(document.title);

  const handleStartEditing = React.useCallback(() => {
    setValue(document.title);
    setIsEditing(true);
  }, [document.title]);

  const handleCommit = React.useCallback(async () => {
    const title = value.trim();
    setIsEditing(false);
    if (!title || title === document.title) {
      return;
    }
    try {
      await documents.update({ id: document.id, title });
    } catch (error) {
      toast.error(errToString(error));
    }
  }, [documents, document, value]);

  const handleKeyDown = React.useCallback(
    (ev: React.KeyboardEvent<HTMLInputElement>) => {
      if (ev.nativeEvent.isComposing) {
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        void handleCommit();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        setValue(document.title);
        setIsEditing(false);
      }
    },
    [handleCommit, document.title]
  );

  return (
    <TitleRow align="center" gap={8}>
      {document.icon && (
        <Icon
          value={document.icon}
          color={document.color ?? undefined}
          size={32}
          initial={document.initial}
        />
      )}
      <FullWidthHeading>
        {isEditing ? (
          <HeadingInput
            type="text"
            value={value}
            placeholder={t("Untitled")}
            maxLength={DocumentValidation.maxTitleLength}
            onChange={(ev) => setValue(ev.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void handleCommit()}
            autoFocus
          />
        ) : (
          <HeadingText
            onClick={can.update ? handleStartEditing : undefined}
            $editable={!!can.update}
            title={can.update ? t("Click to rename") : undefined}
          >
            {document.titleWithDefault}
          </HeadingText>
        )}
      </FullWidthHeading>
    </TitleRow>
  );
}

const TitleRow = styled(Flex)`
  margin-top: 1em;
`;

const FullWidthHeading = styled(Heading)`
  flex-grow: 1;
  margin: 0;
`;

const HeadingText = styled.span<{ $editable: boolean }>`
  ${(props) => (props.$editable ? "cursor: text;" : "")}
`;

const HeadingInput = styled.input`
  border: 0;
  outline: none;
  background: none;
  color: ${s("text")};
  font: inherit;
  line-height: inherit;
  width: 100%;
  padding: 0;
  margin: 0;

  &::placeholder {
    color: ${s("placeholder")};
  }
`;

export default observer(DatabaseDocumentTitle);
