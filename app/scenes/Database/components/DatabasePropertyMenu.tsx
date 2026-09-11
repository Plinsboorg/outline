import { observer } from "mobx-react";
import {
  CheckmarkIcon,
  EyeIcon,
  NextIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  TableIcon,
  TrashIcon,
} from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import { s } from "@shared/styles";
import type {
  DataViewSort,
  Property,
  PropertyConfig,
  PropertyOption,
} from "@shared/types";
import { PropertyType } from "@shared/types";
import { relationConfigForTarget } from "@shared/utils/properties";
import { PropertyValidation } from "@shared/validations";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import PropertyOptionsEditor from "~/components/Database/PropertyOptionsEditor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/primitives/Popover";
import useStores from "~/hooks/useStores";
import PropertyPickerStep from "./PropertyPickerStep";

type Props = {
  /** The database the property belongs to. */
  databaseId: string;
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
  /** Whether the column's cells wrap onto as many lines as they need. */
  wrap?: boolean;
  /** Callback when wrapping is toggled for the column; absent when not allowed. */
  onToggleWrap?: (wrap: boolean) => void;
  /** Callback when the property is deleted from the schema; absent for the
   * title column, which cannot be deleted. */
  onDelete?: () => void;
  /** The header content acting as the menu trigger. */
  children: React.ReactNode;
};

/** The steps the menu can show, beyond the menu itself. */
type Step = "menu" | "target" | "view";

/** The option standing for "do not limit which rows may be linked". */
const ALL_ROWS = "all";

/**
 * The settings menu of a table column, opened by clicking its header: rename
 * inline, sort the view, hide the property, edit select options and their
 * colors, configure a relation, or delete the property from the schema.
 *
 * The choices that are a list of their own — the database a relation points
 * at, the view it may link rows from — replace the menu with a step of their
 * own rather than nesting a second popover inside it.
 */
function DatabasePropertyMenu({
  databaseId,
  property,
  sort,
  onRename,
  onSetSort,
  onHide,
  onChangeOptions,
  onChangeConfig,
  wrap,
  onToggleWrap,
  onDelete,
  children,
}: Props) {
  const { t } = useTranslation();
  const { databases } = useStores();
  const [isOpen, setIsOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("menu");
  const [name, setName] = React.useState(property.name);
  const [prefix, setPrefix] = React.useState("");
  const [start, setStart] = React.useState("");

  const supportsOptions =
    property.type === PropertyType.Select ||
    property.type === PropertyType.MultiSelect;
  const supportsAutoNumber =
    property.type === PropertyType.Number && !!onChangeConfig;
  const isRelation =
    property.type === PropertyType.Relation && !!onChangeConfig;
  const isSortable =
    property.type !== PropertyType.Rollup &&
    property.type !== PropertyType.Image;
  const activeDirection =
    sort?.propertyId === property.id ? sort.direction : undefined;

  const target = property.config?.targetDatabaseId
    ? databases.get(property.config.targetDatabaseId)
    : undefined;
  const inversePropertyId = property.config?.inversePropertyId;
  const backLinkName = inversePropertyId
    ? target?.getProperty(inversePropertyId)?.name
    : undefined;
  const limitToView = property.config?.limitToViewId
    ? target?.getView(property.config.limitToViewId)
    : undefined;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setStep("menu");
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

  const handleChangeTarget = (targetDatabaseId: string) => {
    onChangeConfig?.(
      relationConfigForTarget(property.config, targetDatabaseId)
    );
    setStep("menu");
  };

  /**
   * Turning on a back link mints the id the mirror property will use on the
   * target database; turning it off drops it, and the server removes the
   * mirror. Reloading the target database afterwards is the store's job.
   */
  const handleToggleBackLink = (checked: boolean) => {
    onChangeConfig?.({
      ...property.config,
      inversePropertyId: checked ? uuidv4() : undefined,
    });
  };

  const handleLimitToView = (viewId: string) => {
    onChangeConfig?.({
      ...property.config,
      limitToViewId: viewId === ALL_ROWS ? undefined : viewId,
    });
    setStep("menu");
  };

  // a relation may point back at its own database, so the list is not filtered
  // down to the other databases
  const targetOptions = databases.orderedData
    .filter((database) => !database.isArchived || database.id === target?.id)
    .map((database) => ({
      value: database.id,
      label:
        database.id === databaseId
          ? t("{{ databaseName }} (this database)", {
              databaseName: database.name || t("Untitled"),
            })
          : database.name || t("Untitled"),
    }));

  const viewOptions = [
    { value: ALL_ROWS, label: t("All rows") },
    ...(target?.views ?? []).map((view) => ({
      value: view.id,
      label: view.name,
    })),
  ];

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
          {step === "target" ? (
            <PropertyPickerStep
              title={t("Related database")}
              options={targetOptions}
              value={property.config?.targetDatabaseId}
              emptyMessage={t("There are no databases to relate to")}
              onSelect={handleChangeTarget}
              onBack={() => setStep("menu")}
            />
          ) : step === "view" ? (
            <PropertyPickerStep
              title={t("Rows that can be linked")}
              options={viewOptions}
              value={property.config?.limitToViewId ?? ALL_ROWS}
              emptyMessage={t("The related database has no views")}
              onSelect={handleLimitToView}
              onBack={() => setStep("menu")}
            />
          ) : (
            <>
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
              {onToggleWrap && (
                <SwitchPadding>
                  <Switch
                    label={t("Wrap text")}
                    labelPosition="right"
                    checked={!!wrap}
                    onChange={onToggleWrap}
                    inForm={false}
                  />
                </SwitchPadding>
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
              {isRelation && (
                <>
                  <Separator />
                  <SectionLabel type="tertiary" size="xsmall">
                    {t("Relation")}
                  </SectionLabel>
                  <MenuItem type="button" onClick={() => setStep("target")}>
                    <TableIcon />
                    <ItemLabel>
                      {target?.name || t("Choose a database")}
                    </ItemLabel>
                    <Chevron size={18} />
                  </MenuItem>
                  <SwitchPadding>
                    <Switch
                      label={t("Create a back link on the related database")}
                      labelPosition="right"
                      checked={!!inversePropertyId}
                      onChange={handleToggleBackLink}
                      disabled={!property.config?.targetDatabaseId}
                      inForm={false}
                    />
                  </SwitchPadding>
                  {!!backLinkName && (
                    <Hint type="tertiary" size="xsmall">
                      {t(
                        "Shown on {{ databaseName }} as “{{ propertyName }}”",
                        {
                          databaseName: target?.name,
                          propertyName: backLinkName,
                        }
                      )}
                    </Hint>
                  )}
                  <SwitchPadding>
                    <Switch
                      label={t("Allow linking more than one row")}
                      labelPosition="right"
                      checked={property.config?.allowMultiple !== false}
                      onChange={(checked) =>
                        onChangeConfig?.({
                          ...property.config,
                          allowMultiple: checked,
                        })
                      }
                      inForm={false}
                    />
                  </SwitchPadding>
                  {!!target?.views?.length && (
                    <MenuItem type="button" onClick={() => setStep("view")}>
                      <EyeIcon />
                      <ItemLabel>
                        {limitToView
                          ? t("Only rows in {{ viewName }}", {
                              viewName: limitToView.name,
                            })
                          : t("Any row can be linked")}
                      </ItemLabel>
                      <Chevron size={18} />
                    </MenuItem>
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

const Chevron = styled(NextIcon)`
  flex-shrink: 0;
`;

const ItemLabel = styled.span`
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

const Hint = styled(Text)`
  display: block;
  padding: 0 8px 4px;
`;

export default observer(DatabasePropertyMenu);
