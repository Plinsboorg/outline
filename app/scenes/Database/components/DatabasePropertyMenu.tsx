import { observer } from "mobx-react";
import {
  CheckmarkIcon,
  EyeIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  TrashIcon,
} from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import type {
  DataViewSort,
  Property,
  PropertyConfig,
  PropertyOption,
} from "@shared/types";
import { PropertyType } from "@shared/types";
import { PropertyValidation } from "@shared/validations";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import PropertyOptionsEditor from "~/components/Database/PropertyOptionsEditor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/primitives/Popover";

type Props = {
  /** The property the menu configures. */
  property: Property;
  /** The view's active sort, to mark the active direction. */
  sort?: DataViewSort;
  /** Callback when the property is renamed. */
  onRename: (name: string) => void;
  /** Callback when a sort direction is chosen; null clears the sort. */
  onSetSort: (direction: "asc" | "desc" | null) => void;
  /** Callback when the property is hidden from the view; absent for the title
   * column, which cannot be hidden. */
  onHide?: () => void;
  /** Callback when the property's options change. */
  onChangeOptions?: (options: PropertyOption[]) => void;
  /** Callback when the property's config changes, e.g. auto-numbering. */
  onChangeConfig?: (config: PropertyConfig) => void;
  /** Callback when the property is deleted from the schema; absent for the
   * title column, which cannot be deleted. */
  onDelete?: () => void;
  /** The header content acting as the menu trigger. */
  children: React.ReactNode;
};

/**
 * The settings menu of a table column, opened by clicking its header: rename
 * inline, sort the view, hide the property, edit select options and their
 * colors, or delete the property from the schema.
 */
function DatabasePropertyMenu({
  property,
  sort,
  onRename,
  onSetSort,
  onHide,
  onChangeOptions,
  onChangeConfig,
  onDelete,
  children,
}: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const [name, setName] = React.useState(property.name);
  const [prefix, setPrefix] = React.useState("");
  const [start, setStart] = React.useState("");

  const supportsOptions =
    property.type === PropertyType.Select ||
    property.type === PropertyType.MultiSelect;
  const supportsAutoNumber =
    property.type === PropertyType.Number && !!onChangeConfig;
  const isSortable =
    property.type !== PropertyType.Rollup &&
    property.type !== PropertyType.Image;
  const activeDirection =
    sort?.propertyId === property.id ? sort.direction : undefined;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setName(property.name);
      setPrefix(property.config?.autoNumberPrefix ?? "");
      setStart(
        property.config?.autoNumberStart !== undefined
          ? String(property.config.autoNumberStart)
          : ""
      );
    }
  };

  const handleAutoNumberCommit = () => {
    const parsedStart = Number.parseInt(start, 10);
    onChangeConfig?.({
      ...property.config,
      autoNumberPrefix: prefix || undefined,
      autoNumberStart:
        Number.isInteger(parsedStart) && parsedStart >= 0
          ? parsedStart
          : undefined,
    });
  };

  const handleRenameCommit = () => {
    const next = name.trim();
    if (next && next !== property.name) {
      onRename(next);
    } else {
      setName(property.name);
    }
  };

  const handleNameKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.nativeEvent.isComposing) {
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      handleRenameCommit();
      setIsOpen(false);
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      setName(property.name);
    }
  };

  const handleSort = (direction: "asc" | "desc") => {
    onSetSort(activeDirection === direction ? null : direction);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger>
        <HeaderButton type="button">{children}</HeaderButton>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        aria-label={property.name}
        width={280}
        shrink
      >
        <Content>
          <NameInput
            type="text"
            value={name}
            placeholder={t("Property name")}
            maxLength={PropertyValidation.maxNameLength}
            onChange={(ev) => setName(ev.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={handleRenameCommit}
          />
          {isSortable && (
            <>
              <MenuItem type="button" onClick={() => handleSort("asc")}>
                <SortAscendingIcon />
                {t("Sort ascending")}
                {activeDirection === "asc" && <ActiveCheck />}
              </MenuItem>
              <MenuItem type="button" onClick={() => handleSort("desc")}>
                <SortDescendingIcon />
                {t("Sort descending")}
                {activeDirection === "desc" && <ActiveCheck />}
              </MenuItem>
            </>
          )}
          {onHide && (
            <MenuItem
              type="button"
              onClick={() => {
                onHide();
                setIsOpen(false);
              }}
            >
              <EyeIcon />
              {t("Hide in view")}
            </MenuItem>
          )}
          {supportsOptions && onChangeOptions && (
            <>
              <Separator />
              <SectionLabel type="tertiary" size="xsmall">
                {t("Options")}
              </SectionLabel>
              <PropertyOptionsEditor
                options={property.options ?? []}
                onChange={onChangeOptions}
              />
            </>
          )}
          {supportsAutoNumber && (
            <>
              <Separator />
              <SectionLabel type="tertiary" size="xsmall">
                {t("Auto-number")}
              </SectionLabel>
              <SwitchPadding>
                <Switch
                  label={t("Number rows automatically")}
                  labelPosition="right"
                  checked={!!property.config?.autoNumber}
                  onChange={(checked) =>
                    onChangeConfig?.({
                      ...property.config,
                      autoNumber: checked || undefined,
                    })
                  }
                  inForm={false}
                />
              </SwitchPadding>
              {property.config?.autoNumber && (
                <AutoNumberRow>
                  <SmallInput
                    type="text"
                    value={prefix}
                    placeholder={t("Prefix")}
                    maxLength={PropertyValidation.maxAutoNumberPrefixLength}
                    onChange={(ev) => setPrefix(ev.target.value)}
                    onBlur={handleAutoNumberCommit}
                  />
                  <SmallInput
                    type="number"
                    min={0}
                    value={start}
                    placeholder={t("Start at")}
                    onChange={(ev) => setStart(ev.target.value)}
                    onBlur={handleAutoNumberCommit}
                  />
                </AutoNumberRow>
              )}
            </>
          )}
          {onDelete && (
            <>
              <Separator />
              <MenuItem
                type="button"
                $danger
                onClick={() => {
                  onDelete();
                  setIsOpen(false);
                }}
              >
                <TrashIcon />
                {t("Delete property")}
              </MenuItem>
            </>
          )}
        </Content>
      </PopoverContent>
    </Popover>
  );
}

const ActiveCheck = styled(CheckmarkIcon)`
  margin-left: auto;
`;

const Content = styled.div`
  padding: 4px 10px;
`;

const HeaderButton = styled.button`
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  padding: 8px 10px;
  cursor: var(--pointer);
  display: flex;
  width: 100%;
  align-items: center;
  gap: 2px;
  text-align: left;

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
  }
`;

const NameInput = styled.input`
  border: 1px solid ${s("inputBorder")};
  outline: none;
  background: none;
  color: ${s("text")};
  font-size: 14px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 4px;
  margin-bottom: 8px;

  &:focus {
    border-color: ${s("inputBorderFocused")};
  }

  &::placeholder {
    color: ${s("placeholder")};
  }
`;

const MenuItem = styled.button<{ $danger?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: none;
  color: ${(props) => (props.$danger ? props.theme.danger : props.theme.text)};
  font-size: 14px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: var(--pointer);
  text-align: left;

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const Separator = styled.hr`
  border: 0;
  border-top: 1px solid ${s("divider")};
  margin: 8px 0;
`;

const SwitchPadding = styled.div`
  padding: 2px 8px;
`;

const AutoNumberRow = styled.div`
  display: flex;
  gap: 8px;
  padding: 6px 8px 2px;
`;

const SmallInput = styled.input`
  border: 1px solid ${s("inputBorder")};
  outline: none;
  background: none;
  color: ${s("text")};
  font-size: 13px;
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 4px;

  &:focus {
    border-color: ${s("inputBorderFocused")};
  }

  &::placeholder {
    color: ${s("placeholder")};
  }
`;

const SectionLabel = styled(Text)`
  display: block;
  margin: 0 0 4px;
`;

export default observer(DatabasePropertyMenu);
