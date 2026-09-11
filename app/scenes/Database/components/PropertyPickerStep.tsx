import { BackIcon, CheckmarkIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Text from "~/components/Text";

export type PickerOption = {
  /** The value handed back when the option is chosen. */
  value: string;
  /** The name shown in the list. */
  label: string;
};

type Props = {
  /** The heading of the step, naming what is being picked. */
  title: string;
  /** The options to choose between. */
  options: PickerOption[];
  /** The currently chosen value, marked with a checkmark. */
  value?: string | null;
  /** What to say in place of the list when there is nothing to choose from. */
  emptyMessage: string;
  /** Callback when an option is chosen. */
  onSelect: (value: string) => void;
  /** Callback returning to the menu this step was opened from. */
  onBack: () => void;
};

/**
 * One step of a property menu: a titled list of options with a button back to
 * the menu it was opened from. Used for the settings whose choices are a list
 * too long to inline, such as the database a relation points at.
 */
function PropertyPickerStep({
  title,
  options,
  value,
  emptyMessage,
  onSelect,
  onBack,
}: Props) {
  const { t } = useTranslation();

  return (
    <>
      <Header>
        <BackButton type="button" onClick={onBack} aria-label={t("Back")}>
          <BackIcon size={18} />
        </BackButton>
        <Text type="tertiary" size="xsmall">
          {title}
        </Text>
      </Header>
      {options.length === 0 ? (
        <Empty type="tertiary" size="small">
          {emptyMessage}
        </Empty>
      ) : (
        <List>
          {options.map((option) => (
            <Option
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
            >
              <OptionName>{option.label}</OptionName>
              {option.value === value && <CheckmarkIcon size={18} />}
            </Option>
          ))}
        </List>
      )}
    </>
  );
}

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
`;

const BackButton = styled.button`
  display: flex;
  align-items: center;
  border: 0;
  background: none;
  color: ${s("textSecondary")};
  padding: 2px;
  border-radius: 4px;
  cursor: var(--pointer);

  &:hover {
    background: ${s("listItemHoverBackground")};
    color: ${s("text")};
  }
`;

const List = styled.div`
  max-height: 260px;
  overflow-y: auto;
`;

const Option = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: none;
  color: ${s("text")};
  font-size: 14px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: var(--pointer);
  text-align: left;

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const OptionName = styled.span`
  flex-grow: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Empty = styled(Text)`
  display: block;
  padding: 4px 8px 8px;
`;

export default PropertyPickerStep;
