import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { css } from "styled-components";
import { propertyChipStyles } from "@shared/components/PropertyChip";
import { s } from "@shared/styles";
import type { Property, PropertyValue } from "@shared/types";
import { AttachmentPreset, PropertyType } from "@shared/types";
import { errToString } from "@shared/utils/error";
import { sanitizeImageSrc, sanitizeUrl } from "@shared/utils/urls";
import { Inner } from "~/components/Button";
import { InputSelect } from "~/components/InputSelect";
import Switch from "~/components/Switch";
import useStores from "~/hooks/useStores";
import { uploadFile } from "~/utils/files";

const EMPTY_VALUE = "";

type Props = {
  /** The property definition from the collection's data schema. */
  property: Property;
  /** The current value of the property on the document. */
  value: PropertyValue | undefined;
  /** Callback with the new value; null unsets the property. */
  onChange: (value: PropertyValue | null) => void;
  /** Whether the value cannot be edited. */
  readOnly?: boolean;
  /** The document the value belongs to, associating uploaded files with it. */
  documentId?: string;
};

/**
 * Renders a typed editor for a single document property value, switching on
 * the property type from the collection's data schema.
 */
function PropertyValueEditor({
  property,
  value,
  onChange,
  readOnly,
  documentId,
}: Props) {
  const { t } = useTranslation();
  const { users } = useStores();

  const handleSelectChange = React.useCallback(
    (next: string) => onChange(next === EMPTY_VALUE ? null : next),
    [onChange]
  );

  const handleTextCommit = React.useCallback(
    (ev: React.FocusEvent<HTMLInputElement>) => {
      const next = ev.target.value.trim();
      const current = typeof value === "string" ? value : undefined;
      if (next === (current ?? "")) {
        return;
      }
      onChange(next === "" ? null : next);
    },
    [onChange, value]
  );

  const handleNumberCommit = React.useCallback(
    (ev: React.FocusEvent<HTMLInputElement>) => {
      const raw = ev.target.value.trim();
      if (raw === "") {
        if (value !== undefined) {
          onChange(null);
        }
        return;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed !== value) {
        onChange(parsed);
      }
    },
    [onChange, value]
  );

  const handleKeyDown = React.useCallback(
    (ev: React.KeyboardEvent<HTMLInputElement>) => {
      if (ev.key === "Enter") {
        ev.currentTarget.blur();
      }
    },
    []
  );

  const handleToggleOption = React.useCallback(
    (optionId: string) => {
      const current = Array.isArray(value) ? value : [];
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      onChange(next.length === 0 ? null : next);
    },
    [onChange, value]
  );

  switch (property.type) {
    case PropertyType.Text:
      return (
        <NudeInput
          type="text"
          defaultValue={typeof value === "string" ? value : ""}
          placeholder={readOnly ? "–" : t("Empty")}
          onBlur={handleTextCommit}
          onKeyDown={handleKeyDown}
          disabled={readOnly}
        />
      );

    case PropertyType.Number: {
      // auto-numbered values are assigned by the server and never edited
      if (property.config?.autoNumber) {
        return typeof value === "number" ? (
          <AutoNumberValue>
            {`${property.config.autoNumberPrefix ?? ""}${value}`}
          </AutoNumberValue>
        ) : (
          <Placeholder>–</Placeholder>
        );
      }
      return (
        // a text input rather than type="number": number inputs keep a fixed
        // intrinsic width in Blink, which stops their table column from being
        // resized narrow — parsing happens on commit either way
        <NudeInput
          type="text"
          inputMode="decimal"
          defaultValue={typeof value === "number" ? String(value) : ""}
          placeholder={readOnly ? "–" : t("Empty")}
          onBlur={handleNumberCommit}
          onKeyDown={handleKeyDown}
          disabled={readOnly}
        />
      );
    }

    case PropertyType.Checkbox:
      return (
        <Switch
          checked={value === true}
          onChange={(checked) => onChange(checked)}
          disabled={readOnly}
          inForm={false}
        />
      );

    case PropertyType.Date: {
      const date = typeof value === "string" ? value.slice(0, 10) : "";
      return (
        <NudeInput
          type="date"
          defaultValue={date}
          onBlur={handleTextCommit}
          disabled={readOnly}
        />
      );
    }

    case PropertyType.Url: {
      const url = typeof value === "string" ? value : "";
      if (readOnly) {
        return url ? (
          <UrlLink
            href={sanitizeUrl(url)}
            target="_blank"
            rel="noreferrer nofollow"
          >
            {url}
          </UrlLink>
        ) : (
          <Placeholder>–</Placeholder>
        );
      }
      return (
        <UrlCellEditor
          url={url}
          onCommit={handleTextCommit}
          onKeyDown={handleKeyDown}
          t={t}
        />
      );
    }

    case PropertyType.Image:
      return (
        <ImageValueEditor
          property={property}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          documentId={documentId}
        />
      );

    case PropertyType.Select: {
      const options = property.options ?? [];
      if (readOnly) {
        const selected = options.find((option) => option.id === value);
        return selected ? (
          <Chip $color={selected.color}>{selected.name}</Chip>
        ) : (
          <Placeholder>–</Placeholder>
        );
      }
      return (
        <ChipSelect
          options={[
            { type: "item", label: t("None"), value: EMPTY_VALUE },
            ...options.map((option) => ({
              type: "item" as const,
              label: option.name,
              value: option.id,
              icon: <ColorDot $color={option.color} />,
            })),
          ]}
          value={typeof value === "string" ? value : EMPTY_VALUE}
          onChange={handleSelectChange}
          displayValue={(selected) => {
            const option = options.find((item) => item.id === selected?.value);
            return option ? (
              <Chip $color={option.color}>{option.name}</Chip>
            ) : (
              <Placeholder>–</Placeholder>
            );
          }}
          label={property.name}
          labelHidden
          short
          // the value is a chip that carries its own color, so the control
          // around it only draws itself once the cell is pointed at
          borderOnHover
        />
      );
    }

    case PropertyType.MultiSelect: {
      const options = property.options ?? [];
      const selectedIds = Array.isArray(value) ? value : [];
      return (
        <ChipList>
          {options.map((option) => {
            const selected = selectedIds.includes(option.id);
            if (readOnly && !selected) {
              return null;
            }
            return (
              <ChipButton
                key={option.id}
                type="button"
                $selected={selected}
                $color={option.color}
                onClick={
                  readOnly ? undefined : () => handleToggleOption(option.id)
                }
                disabled={readOnly}
              >
                {option.name}
              </ChipButton>
            );
          })}
          {readOnly && selectedIds.length === 0 && <Placeholder>–</Placeholder>}
        </ChipList>
      );
    }

    case PropertyType.Rollup: {
      return typeof value === "number" ? (
        <RollupValue>{formatRollupValue(value)}</RollupValue>
      ) : (
        <Placeholder>–</Placeholder>
      );
    }

    case PropertyType.Relation: {
      return (
        <RelationValueEditor
          property={property}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
    }

    case PropertyType.Person: {
      if (readOnly) {
        const user = typeof value === "string" ? users.get(value) : undefined;
        return user ? <span>{user.name}</span> : <Placeholder>–</Placeholder>;
      }
      return (
        <InputSelect
          options={[
            { type: "item", label: t("None"), value: EMPTY_VALUE },
            ...users.activeOrInvited.map((user) => ({
              type: "item" as const,
              label: user.name,
              value: user.id,
            })),
          ]}
          value={typeof value === "string" ? value : EMPTY_VALUE}
          onChange={handleSelectChange}
          label={property.name}
          labelHidden
          short
        />
      );
    }

    default:
      return null;
  }
}

/**
 * Edits an image property value: an empty value offers a file picker whose
 * upload is stored as an attachment, a set value shows a thumbnail that can
 * be replaced or removed.
 */
function ImageValueEditor({
  property,
  value,
  onChange,
  readOnly,
  documentId,
}: Props) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const src = typeof value === "string" ? sanitizeImageSrc(value) : undefined;

  const handleFileChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    // reset so picking the same file again still fires a change event
    ev.target.value = "";
    if (!file) {
      return;
    }
    setIsUploading(true);
    try {
      const attachment = await uploadFile(file, {
        preset: AttachmentPreset.DocumentAttachment,
        documentId,
      });
      onChange(attachment.url);
    } catch (error) {
      toast.error(errToString(error));
    } finally {
      setIsUploading(false);
    }
  };

  if (readOnly) {
    return src ? (
      <Thumbnail src={src} alt={property.name} />
    ) : (
      <Placeholder>–</Placeholder>
    );
  }

  return (
    <ChipList>
      <HiddenFileInput
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />
      {src ? (
        <>
          <ThumbnailButton
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            aria-label={t("Replace image")}
          >
            <Thumbnail src={src} alt={property.name} />
          </ThumbnailButton>
          <ChipRemove
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("Remove")}
          >
            ×
          </ChipRemove>
        </>
      ) : (
        <AddImageButton
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? `${t("Uploading")}…` : t("Add image")}
        </AddImageButton>
      )}
    </ChipList>
  );
}

/**
 * URL cell editor for table view: shows URL as a clickable link with underline styling.
 * Clicking on the text opens the link. Clicking near the text or double-clicking enters edit mode.
 */
function UrlCellEditor({
  url,
  onCommit,
  onKeyDown,
  t,
}: {
  url: string;
  onCommit: (ev: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown: (ev: React.KeyboardEvent<HTMLInputElement>) => void;
  t: ReturnType<typeof useTranslation>["t"];
}): React.ReactElement {
  const [isEditing, setIsEditing] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Allow default link behavior (open in new tab)
    // But we prevent default to handle it ourselves for better UX
    event.preventDefault();
    if (url) {
      window.open(sanitizeUrl(url), "_blank", "noopener,noreferrer");
    }
  };

  const handleCellClick = (event: React.MouseEvent) => {
    // If clicking directly on the link text, open it
    if ((event.target as HTMLElement).tagName === "A") {
      return;
    }
    // Otherwise, enter edit mode
    setIsEditing(true);
  };

  const handleInputBlur = (ev: React.FocusEvent<HTMLInputElement>) => {
    onCommit(ev);
    setIsEditing(false);
  };

  const handleInputKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Escape") {
      setIsEditing(false);
      return;
    }
    onKeyDown(ev);
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <NudeInput
        ref={inputRef}
        type="url"
        defaultValue={url}
        placeholder={t("Empty")}
        onBlur={handleInputBlur}
        onKeyDown={handleInputKeyDown}
      />
    );
  }

  if (!url) {
    return <Placeholder>–</Placeholder>;
  }

  return (
    <UrlLinkCell
      onClick={handleCellClick}
      onDoubleClick={handleDoubleClick}
    >
      <UrlLink
        href={sanitizeUrl(url)}
        target="_blank"
        rel="noreferrer nofollow"
        onClick={handleLinkClick}
        role="button"
        tabIndex={0}
      >
        {url}
      </UrlLink>
    </UrlLinkCell>
  );
}

const RelationValueEditor = observer(function RelationValueEditor_({
  property,
  value,
  onChange,
  readOnly,
}: Props) {
  const { t } = useTranslation();
  const { documents, databases } = useStores();
  const targetDatabaseId = property.config?.targetDatabaseId;
  const limitToViewId = property.config?.limitToViewId;
  const allowMultiple = property.config?.allowMultiple !== false;
  const selectedIds = React.useMemo(
    () => (Array.isArray(value) ? value : []),
    [value]
  );

  const [candidateIds, setCandidateIds] = React.useState<string[]>();

  // fetch documents referenced by the current value so their titles resolve
  React.useEffect(() => {
    for (const id of selectedIds) {
      if (!documents.get(id)) {
        void documents.fetch(id).catch(() => {
          // referenced document is inaccessible — leave it out of the list
        });
      }
    }
  }, [documents, selectedIds]);

  React.useEffect(() => {
    if (readOnly || candidateIds !== undefined) {
      return;
    }
    async function load() {
      try {
        if (!targetDatabaseId) {
          setCandidateIds([]);
          return;
        }
        // when the property limits selection to a view, only rows matching
        // that view's filter may be linked
        const view = limitToViewId
          ? databases.get(targetDatabaseId)?.getView(limitToViewId)
          : undefined;
        const { rows } = await documents.fetchInDatabase({
          databaseId: targetDatabaseId,
          filter: view?.filter,
          limit: 100,
        });
        setCandidateIds(rows.map((item) => item.id));
      } catch (_err) {
        setCandidateIds([]);
      }
    }
    void load();
  }, [
    readOnly,
    candidateIds,
    documents,
    databases,
    targetDatabaseId,
    limitToViewId,
  ]);

  const handleRemove = (id: string) => {
    const next = selectedIds.filter((item) => item !== id);
    onChange(next.length === 0 ? null : next);
  };

  const handleAdd = (id: string) => {
    if (id === EMPTY_VALUE || selectedIds.includes(id)) {
      return;
    }
    onChange(allowMultiple ? [...selectedIds, id] : [id]);
  };

  const options = (candidateIds ?? [])
    .filter((id) => !selectedIds.includes(id))
    .map((id) => documents.get(id))
    .filter((document) => !!document)
    .map((document) => ({
      type: "item" as const,
      label: document.titleWithDefault,
      value: document.id,
    }));

  return (
    <ChipList>
      {selectedIds.map((id) => {
        const document = documents.get(id);
        if (!document) {
          return null;
        }
        return (
          <Chip key={id}>
            {document.titleWithDefault}
            {!readOnly && (
              <ChipRemove
                type="button"
                onClick={() => handleRemove(id)}
                aria-label={t("Remove")}
              >
                ×
              </ChipRemove>
            )}
          </Chip>
        );
      })}
      {readOnly && selectedIds.length === 0 && <Placeholder>–</Placeholder>}
      {!readOnly && (
        <InputSelect
          options={[
            {
              type: "item" as const,
              label: t("Add document"),
              value: EMPTY_VALUE,
            },
            ...options,
          ]}
          value={EMPTY_VALUE}
          onChange={handleAdd}
          label={property.name}
          labelHidden
          short
        />
      )}
    </ChipList>
  );
});

function formatRollupValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const RollupValue = styled.span`
  padding: 4px 6px;
  color: ${s("textSecondary")};
`;

const AutoNumberValue = styled.span`
  padding: 4px 6px;
`;

const NudeInput = styled.input`
  border: 0;
  outline: none;
  background: none;
  color: ${s("text")};
  font-size: 14px;
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 4px;

  &:hover:not(:disabled),
  &:focus:not(:disabled) {
    background: ${s("backgroundSecondary")};
  }

  &::placeholder {
    color: ${s("placeholder")};
  }

  &:disabled {
    color: ${s("textSecondary")};
  }
`;

const Placeholder = styled.span`
  color: ${s("placeholder")};
  padding: 4px 6px;
`;

const UrlLink = styled.a`
  color: ${s("accent")};
  padding: 4px 6px;
  overflow-wrap: anywhere;
  text-decoration: underline;
`;

const UrlLinkCell = styled.div`
  cursor: text;
  padding: 4px 6px;
  border-radius: 4px;
  
  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const ChipList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 6px;
`;

const Thumbnail = styled.img`
  display: block;
  height: 24px;
  max-width: 120px;
  border-radius: 3px;
  object-fit: cover;
`;

const ThumbnailButton = styled.button`
  border: 0;
  background: none;
  padding: 0;
  cursor: var(--pointer);

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const AddImageButton = styled.button`
  border: 0;
  background: none;
  color: ${s("placeholder")};
  font-size: 14px;
  padding: 2px 0;
  cursor: var(--pointer);

  &:hover:not(:disabled) {
    color: ${s("textSecondary")};
  }
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const Chip = styled.span<{ $color?: string }>`
  ${propertyChipStyles}
`;

/** A select whose trigger stays out of the way of the chip it displays. */
const ChipSelect = styled(InputSelect)`
  && ${Inner} {
    line-height: 26px;
    padding-inline-start: 6px;
    padding-inline-end: 2px;
  }
`;

const ColorDot = styled.span<{ $color?: string }>`
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: ${(props) => props.$color ?? props.theme.backgroundSecondary};
  box-shadow: inset 0 0 0 1px ${s("inputBorder")};
`;

const ChipRemove = styled.button`
  border: 0;
  background: none;
  color: ${s("textSecondary")};
  font-size: 13px;
  padding: 0 0 0 4px;
  cursor: var(--pointer);

  &:hover {
    color: ${s("text")};
  }
`;

const ChipButton = styled.button<{ $selected: boolean; $color?: string }>`
  ${propertyChipStyles}
  // a transparent border on the selected state too, so toggling an option
  // does not shift the chips beside it
  border: 1px solid transparent;
  cursor: var(--pointer);

  ${(props) =>
    !props.$selected &&
    css`
      background: none;
      border-color: ${s("inputBorder")};
      color: ${s("textSecondary")};
    `}

  &:disabled {
    cursor: default;
  }
`;

export default observer(PropertyValueEditor);
