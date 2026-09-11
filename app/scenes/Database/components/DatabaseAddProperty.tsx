import { observer } from "mobx-react";
import {
  BulletedListIcon,
  CalendarIcon,
  CheckboxIcon,
  EditIcon,
  HashtagIcon,
  ImageIcon,
  LinkIcon,
  PlusIcon,
  ShuffleIcon,
  SummaryIcon,
  TodoListIcon,
  UserIcon,
} from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import { s } from "@shared/styles";
import type { Property } from "@shared/types";
import { PropertyType } from "@shared/types";
import { errToString } from "@shared/utils/error";
import { relationConfigForTarget } from "@shared/utils/properties";
import NudeButton from "~/components/NudeButton";
import Tooltip from "~/components/Tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/primitives/Popover";
import useStores from "~/hooks/useStores";
import PropertyPickerStep from "./PropertyPickerStep";

type Props = {
  /** The database the property is added to. */
  databaseId: string;
  /** The names already used by the schema, to derive a unique default name. */
  existingNames: string[];
  /** Callback with the new property to append to the schema. */
  onAdd: (property: Property) => Promise<void>;
  /** Callback opening the full schema editor, for Rollup — absent when the
   * caller does not offer it (e.g. no update permission). */
  onOpenSchemaEditor?: () => void;
};

/**
 * Property types that can be created with nothing more than a name.
 */
const simpleTypes: {
  type: PropertyType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { type: PropertyType.Text, label: "Text", icon: <EditIcon /> },
  { type: PropertyType.Number, label: "Number", icon: <HashtagIcon /> },
  { type: PropertyType.Select, label: "Select", icon: <TodoListIcon /> },
  {
    type: PropertyType.MultiSelect,
    label: "Multi-select",
    icon: <BulletedListIcon />,
  },
  {
    type: PropertyType.Checkbox,
    label: "Checkbox",
    icon: <CheckboxIcon checked={false} />,
  },
  { type: PropertyType.Date, label: "Date", icon: <CalendarIcon /> },
  { type: PropertyType.Url, label: "URL", icon: <LinkIcon /> },
  { type: PropertyType.Person, label: "Person", icon: <UserIcon /> },
  { type: PropertyType.Image, label: "Image", icon: <ImageIcon /> },
];

/**
 * A "+" button opening a menu of property types. Clicking a simple type
 * immediately appends a property of that type, named after the type; it can
 * then be renamed by clicking the new column's header.
 *
 * A relation cannot exist without a database to point at, so choosing it asks
 * which one in a second step and names the column after it; everything else
 * about the relation is then set from the column's own settings menu. Rollups
 * need more than one choice up front and still open the full schema editor.
 */
function DatabaseAddProperty({
  databaseId,
  existingNames,
  onAdd,
  onOpenSchemaEditor,
}: Props) {
  const { t } = useTranslation();
  const { databases } = useStores();
  const [isOpen, setIsOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPickingTarget, setIsPickingTarget] = React.useState(false);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setIsPickingTarget(false);
    }
  };

  const handleOpenSchemaEditor = () => {
    setIsOpen(false);
    onOpenSchemaEditor?.();
  };

  const addProperty = async (property: Omit<Property, "id">) => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onAdd({
        ...property,
        id: uuidv4(),
        name: uniqueName(property.name, existingNames),
      });
      setIsOpen(false);
    } catch (error) {
      toast.error(errToString(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectType = (type: PropertyType, label: string) =>
    addProperty({
      name: t(label),
      type,
      options:
        type === PropertyType.Select || type === PropertyType.MultiSelect
          ? []
          : undefined,
    });

  const handleSelectTarget = (targetDatabaseId: string) =>
    addProperty({
      name: databases.get(targetDatabaseId)?.name || t("Relation"),
      type: PropertyType.Relation,
      config: relationConfigForTarget(
        { allowMultiple: true },
        targetDatabaseId
      ),
    });

  // a relation may point back at its own database, so the list is not filtered
  // down to the other databases
  const targetOptions = databases.orderedData
    .filter((database) => !database.isArchived)
    .map((database) => ({
      value: database.id,
      label:
        database.id === databaseId
          ? t("{{ databaseName }} (this database)", {
              databaseName: database.name || t("Untitled"),
            })
          : database.name || t("Untitled"),
    }));

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip content={t("Add property")}>
        <PopoverTrigger>
          <AddButton type="button" aria-label={t("Add property")} size={24}>
            <PlusIcon size={18} />
          </AddButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="end"
        aria-label={t("Add property")}
        width={isPickingTarget ? 240 : 180}
        shrink
      >
        <Content>
          {isPickingTarget ? (
            <PropertyPickerStep
              title={t("Relate to")}
              options={targetOptions}
              emptyMessage={t("There are no databases to relate to")}
              onSelect={(value) => void handleSelectTarget(value)}
              onBack={() => setIsPickingTarget(false)}
            />
          ) : (
            <>
              {simpleTypes.map((item) => (
                <TypeItem
                  key={item.type}
                  type="button"
                  onClick={() => void handleSelectType(item.type, item.label)}
                  disabled={isSaving}
                >
                  {item.icon}
                  {t(item.label)}
                </TypeItem>
              ))}
              <Divider />
              <TypeItem
                type="button"
                onClick={() => setIsPickingTarget(true)}
                disabled={isSaving}
              >
                <ShuffleIcon />
                {t("Relation")}…
              </TypeItem>
              {onOpenSchemaEditor && (
                <TypeItem type="button" onClick={handleOpenSchemaEditor}>
                  <SummaryIcon />
                  {t("Rollup")}…
                </TypeItem>
              )}
            </>
          )}
        </Content>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Derives a name that does not collide with existing property names by
 * appending an increasing counter, e.g. "Text", "Text 2", "Text 3".
 */
function uniqueName(base: string, existingNames: string[]): string {
  const normalized = new Set(
    existingNames.map((name) => name.trim().toLowerCase())
  );
  if (!normalized.has(base.toLowerCase())) {
    return base;
  }
  let counter = 2;
  while (normalized.has(`${base.toLowerCase()} ${counter}`)) {
    counter += 1;
  }
  return `${base} ${counter}`;
}

const Content = styled.div`
  padding: 0 6px;
`;

const Divider = styled.hr`
  border: 0;
  border-top: 1px solid ${s("divider")};
  margin: 4px 0;
`;

const AddButton = styled(NudeButton)`
  color: ${s("textSecondary")};
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
  }
`;

const TypeItem = styled.button`
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

  &:hover:not(:disabled) {
    background: ${s("listItemHoverBackground")};
  }

  &:disabled {
    color: ${s("textSecondary")};
    cursor: default;
  }
`;

export default observer(DatabaseAddProperty);
