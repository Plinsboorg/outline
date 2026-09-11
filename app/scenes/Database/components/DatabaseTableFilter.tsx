import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { FilterCondition, Property, PropertyValue } from "@shared/types";
import { PropertyType } from "@shared/types";
import {
  defaultFilterValue,
  filterOperatorLabels,
  filterOperatorsForProperty,
  isValuelessFilterOperator,
} from "@shared/utils/properties";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import { InputSelect } from "~/components/InputSelect";
import useStores from "~/hooks/useStores";

type Props = {
  /** The collection's data schema. */
  schema: Property[];
  /** The currently applied filter condition, if any. */
  filter?: FilterCondition;
  /** Callback with the new filter condition, or undefined to clear. */
  onChange: (filter?: FilterCondition) => void;
};

const NONE = "";

/**
 * A single-condition filter bar for the database table view: pick a
 * property, an operator valid for its type, and a comparison value.
 */
function DatabaseTableFilter({ schema, filter, onChange }: Props) {
  const { t } = useTranslation();
  const { users } = useStores();

  const property = schema.find((item) => item.id === filter?.propertyId);

  const handleProperty = (propertyId: string) => {
    if (propertyId === NONE) {
      onChange(undefined);
      return;
    }
    const next = schema.find((item) => item.id === propertyId);
    if (!next) {
      return;
    }
    const operator = filterOperatorsForProperty(next.type)[0];
    if (!operator) {
      return;
    }
    onChange({
      propertyId,
      operator,
      value: defaultFilterValue(next, operator),
    });
  };

  const handleOperator = (value: string) => {
    if (!filter || !property) {
      return;
    }
    const operator = filterOperatorsForProperty(property.type).find(
      (item) => item === value
    );
    if (!operator) {
      return;
    }
    onChange({
      ...filter,
      operator,
      value: isValuelessFilterOperator(operator)
        ? undefined
        : (filter.value ?? defaultFilterValue(property, operator)),
    });
  };

  const handleValue = (value: PropertyValue | undefined) => {
    if (!filter) {
      return;
    }
    onChange({ ...filter, value: value ?? undefined });
  };

  const renderValueInput = () => {
    if (!filter || !property || isValuelessFilterOperator(filter.operator)) {
      return null;
    }

    switch (property.type) {
      case PropertyType.Select:
      case PropertyType.MultiSelect:
        return (
          <InputSelect
            options={(property.options ?? []).map((option) => ({
              type: "item" as const,
              label: option.name,
              value: option.id,
            }))}
            value={typeof filter.value === "string" ? filter.value : null}
            onChange={handleValue}
            label={t("Value")}
            labelHidden
            short
          />
        );

      case PropertyType.Person:
        return (
          <InputSelect
            options={users.activeOrInvited.map((user) => ({
              type: "item" as const,
              label: user.name,
              value: user.id,
            }))}
            value={typeof filter.value === "string" ? filter.value : null}
            onChange={handleValue}
            label={t("Value")}
            labelHidden
            short
          />
        );

      case PropertyType.Checkbox:
        return (
          <InputSelect
            options={[
              { type: "item", label: t("Checked"), value: "true" },
              { type: "item", label: t("Unchecked"), value: "false" },
            ]}
            value={filter.value === false ? "false" : "true"}
            onChange={(value) => handleValue(value === "true")}
            label={t("Value")}
            labelHidden
            short
          />
        );

      case PropertyType.Number:
        return (
          <ValueInput
            type="number"
            defaultValue={
              typeof filter.value === "number" ? String(filter.value) : ""
            }
            onBlur={(ev) => {
              const parsed = Number(ev.target.value);
              handleValue(Number.isFinite(parsed) ? parsed : undefined);
            }}
          />
        );

      case PropertyType.Date:
        return (
          <ValueInput
            type="date"
            defaultValue={
              typeof filter.value === "string" ? filter.value.slice(0, 10) : ""
            }
            onBlur={(ev) => handleValue(ev.target.value || undefined)}
          />
        );

      default:
        return (
          <ValueInput
            type="text"
            defaultValue={typeof filter.value === "string" ? filter.value : ""}
            placeholder={t("Value")}
            onBlur={(ev) => handleValue(ev.target.value || undefined)}
          />
        );
    }
  };

  return (
    <Bar align="center" gap={8} auto>
      <InputSelect
        options={[
          { type: "item", label: t("No filter"), value: NONE },
          ...schema
            .filter((item) => filterOperatorsForProperty(item.type).length > 0)
            .map((item) => ({
              type: "item" as const,
              label: item.name,
              value: item.id,
            })),
        ]}
        value={filter?.propertyId ?? NONE}
        onChange={handleProperty}
        label={t("Filter by")}
        labelHidden
        short
      />
      {filter && property && (
        <>
          <InputSelect
            options={filterOperatorsForProperty(property.type).map(
              (operator) => ({
                type: "item" as const,
                label: t(filterOperatorLabels[operator]),
                value: operator,
              })
            )}
            value={filter.operator}
            onChange={handleOperator}
            label={t("Operator")}
            labelHidden
            short
          />
          {renderValueInput()}
          <Button type="button" onClick={() => onChange(undefined)} neutral>
            {t("Clear")}
          </Button>
        </>
      )}
    </Bar>
  );
}

const Bar = styled(Flex)`
  flex-wrap: wrap;
`;

const ValueInput = styled.input`
  border: 1px solid ${(props) => props.theme.inputBorder};
  border-radius: 4px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.text};
  padding: 6px 8px;
  font-size: 14px;
  outline: none;

  &:focus {
    border-color: ${(props) => props.theme.inputBorderFocused};
  }
`;

export default observer(DatabaseTableFilter);
