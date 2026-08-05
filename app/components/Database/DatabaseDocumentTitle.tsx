import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import Icon from "@shared/components/Icon";
import { colorPalette } from "@shared/constants";
import { s } from "@shared/styles";
import { errToString } from "@shared/utils/error";
import { DocumentValidation } from "@shared/validations";
import type Document from "~/models/Document";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import { PopoverButton } from "~/components/IconPicker/components/PopoverButton";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import lazyWithRetry from "~/utils/lazyWithRetry";

const IconPicker = lazyWithRetry(() => import("~/components/IconPicker"));

const iconSize = 32;

type Props = {
  /** The database's anchor document whose title to show. */
  document: Document;
};

/**
 * The compact heading of a database's page: the document's icon and title
 * with click-to-rename and an icon picker. It stands in for the document
 * editor — a database page shows its views rather than a text body.
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

  const handleChangeIcon = React.useCallback(
    (icon: string | null, color: string | null) => {
      if (
        icon === (document.icon ?? null) &&
        color === (document.color ?? null)
      ) {
        return;
      }
      void documents
        .update({ id: document.id, icon, color })
        .catch((error) => toast.error(errToString(error)));
    },
    [documents, document]
  );

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

  const iconColor = document.color ?? colorPalette[0];
  const staticIcon = document.icon ? (
    <Icon
      value={document.icon}
      color={iconColor}
      size={iconSize}
      initial={document.initial}
    />
  ) : null;

  return (
    <TitleRow align="center" gap={8} $hasIcon={!!document.icon}>
      {can.update ? (
        <React.Suspense fallback={staticIcon}>
          <IconPicker
            icon={document.icon ?? null}
            color={iconColor}
            initial={document.initial}
            size={iconSize}
            popoverPosition="bottom-start"
            onChange={handleChangeIcon}
            allowDelete
            borderOnHover
          />
        </React.Suspense>
      ) : (
        staticIcon
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

// The picker's trigger doubles as the icon, so it stays visible whenever the
// database has one and fades in on hover when it doesn't.
const TitleRow = styled(Flex)<{ $hasIcon: boolean }>`
  margin-top: 1em;

  ${PopoverButton} {
    opacity: ${(props) => (props.$hasIcon ? 1 : 0)};
  }

  &:hover,
  &:focus-within {
    ${PopoverButton} {
      opacity: 1;
    }
  }
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
