import type { DataView, DataViewOverride } from "../types";
import { DataViewType, FilterOperator, SummaryAggregation } from "../types";
import {
  applyViewOverride,
  baseFilterForOverride,
  isEmptyOverride,
  mergeIntoOverride,
  overrideFromLegacySettings,
  parseViewOverride,
} from "./viewOverride";

const view: DataView = {
  id: "view-1",
  name: "Table",
  type: DataViewType.Table,
  columns: [
    { propertyId: "title", visible: true },
    { propertyId: "status", visible: true, width: 120 },
    { propertyId: "owner", visible: false },
  ],
  sorts: [{ propertyId: "status", direction: "asc" }],
  filter: {
    conjunction: "and",
    conditions: [
      { propertyId: "status", operator: FilterOperator.Is, value: "open" },
    ],
  },
};

describe("applyViewOverride", () => {
  it("returns the view untouched when nothing is overridden", () => {
    expect(applyViewOverride(view, null)).toBe(view);
    expect(applyViewOverride(view, {})).toBe(view);
  });

  it("patches only the column settings the override names", () => {
    const result = applyViewOverride(view, {
      columns: [
        { propertyId: "status", visible: false },
        { propertyId: "owner", width: 200, wrap: true },
      ],
    });
    expect(result.columns).toEqual([
      { propertyId: "title", visible: true },
      { propertyId: "status", visible: false, width: 120 },
      { propertyId: "owner", visible: false, width: 200, wrap: true },
    ]);
  });

  it("clears a summary the view sets", () => {
    const withSummary = {
      ...view,
      columns: [
        {
          propertyId: "status",
          visible: true,
          summary: SummaryAggregation.Sum,
        },
      ],
    };
    expect(
      applyViewOverride(withSummary, {
        columns: [{ propertyId: "status", summary: null }],
      }).columns[0].summary
    ).toBeUndefined();
  });

  it("orders columns the override names first, keeping the rest behind", () => {
    const result = applyViewOverride(view, {
      columnOrder: ["status", "title"],
    });
    expect(result.columns.map((column) => column.propertyId)).toEqual([
      "status",
      "title",
      "owner",
    ]);
  });

  it("appends a column the view has fallen behind on", () => {
    const result = applyViewOverride(view, {
      columns: [{ propertyId: "added", width: 90 }],
    });
    expect(result.columns[3]).toEqual({
      propertyId: "added",
      visible: true,
      width: 90,
    });
  });

  it("replaces sorting and grouping, and can turn each off", () => {
    expect(applyViewOverride(view, { sorts: [] }).sorts).toEqual([]);
    expect(
      applyViewOverride(view, {
        sorts: [{ propertyId: "owner", direction: "desc" }],
      }).sorts
    ).toEqual([{ propertyId: "owner", direction: "desc" }]);

    const grouped = { ...view, groupBy: "status" };
    expect(
      applyViewOverride(grouped, { groupBy: null }).groupBy
    ).toBeUndefined();
    expect(applyViewOverride(grouped, { groupBy: "owner" }).groupBy).toEqual(
      "owner"
    );
    expect(
      applyViewOverride(grouped, { columns: [{ propertyId: "owner" }] }).groupBy
    ).toEqual("status");
  });

  it("renders the override's own filter, leaving the view's underneath", () => {
    const own = {
      conjunction: "and" as const,
      conditions: [
        { propertyId: "owner", operator: FilterOperator.IsNotEmpty },
      ],
    };
    expect(applyViewOverride(view, { filter: own }).filter).toEqual(own);
    // an override that says nothing about filtering does not inherit the
    // view's — it is applied beneath, as the base filter
    expect(
      applyViewOverride(view, {
        columns: [{ propertyId: "owner", wrap: true }],
      }).filter
    ).toBeUndefined();
    expect(baseFilterForOverride(view, { columns: [] })).toBeUndefined();
    expect(
      baseFilterForOverride(view, {
        columns: [{ propertyId: "owner", wrap: true }],
      })
    ).toEqual(view.filter);
    expect(baseFilterForOverride(view, null)).toBeUndefined();
  });
});

it("places a column the view does not list, so the order can hold it", () => {
  // a view built for a new database lists its properties but not the title
  // column, which the table adds in front
  const noTitle = {
    ...view,
    columns: [{ propertyId: "status", visible: true }],
  };
  const result = applyViewOverride(noTitle, {
    columnOrder: ["status", "title"],
  });
  expect(result.columns).toEqual([
    { propertyId: "status", visible: true },
    { propertyId: "title", visible: true },
  ]);
});

describe("mergeIntoOverride", () => {
  const columnsWith = (
    changes: Record<string, Partial<DataView["columns"][0]>>
  ) =>
    view.columns.map((column) => ({
      ...column,
      ...changes[column.propertyId],
    }));

  it("stores only what differs from the view", () => {
    expect(
      mergeIntoOverride(
        view,
        {},
        {
          columns: columnsWith({ status: { width: 300 } }),
        }
      )
    ).toEqual({ columns: [{ propertyId: "status", width: 300 }] });
  });

  it("drops a setting returned to the view's own value", () => {
    const override: DataViewOverride = {
      columns: [{ propertyId: "status", width: 300 }],
    };
    expect(
      mergeIntoOverride(view, override, { columns: view.columns })
    ).toEqual({});
    expect(
      isEmptyOverride(
        mergeIntoOverride(view, override, { columns: view.columns })
      )
    ).toBe(true);
  });

  it("stores a changed column order, and drops it when restored", () => {
    const reordered = [view.columns[1], view.columns[0], view.columns[2]];
    const override = mergeIntoOverride(view, {}, { columns: reordered });
    expect(override.columnOrder).toEqual(["status", "title", "owner"]);
    expect(override.columns).toBeUndefined();
    expect(
      mergeIntoOverride(view, override, { columns: view.columns }).columnOrder
    ).toBeUndefined();
  });

  it("does not store the order the view would arrange columns in anyway", () => {
    // the title column sits in front of a view that does not list it, so an
    // unrelated edit must not record that as a reordering
    const noTitle = {
      ...view,
      columns: [{ propertyId: "status", visible: true }],
    };
    const inOrder = [
      { propertyId: "title", visible: true },
      { propertyId: "status", visible: true, width: 300 },
    ];
    expect(mergeIntoOverride(noTitle, {}, { columns: inOrder })).toEqual({
      columns: [{ propertyId: "status", width: 300 }],
    });
  });

  it("stores sorting only while it differs from the view's", () => {
    expect(mergeIntoOverride(view, {}, { sorts: view.sorts })).toEqual({});
    expect(mergeIntoOverride(view, {}, { sorts: [] })).toEqual({ sorts: [] });
  });

  it("stores the filter as the override's own, and clears it when emptied", () => {
    const filter = {
      conjunction: "and" as const,
      conditions: [{ propertyId: "owner", operator: FilterOperator.IsEmpty }],
    };
    expect(mergeIntoOverride(view, {}, { filter })).toEqual({ filter });
    expect(mergeIntoOverride(view, { filter }, { filter: undefined })).toEqual(
      {}
    );
  });

  it("stores grouping against the view's own", () => {
    const grouped = { ...view, groupBy: "status" };
    expect(mergeIntoOverride(grouped, {}, { groupBy: "status" })).toEqual({});
    expect(mergeIntoOverride(grouped, {}, { groupBy: undefined })).toEqual({
      groupBy: null,
    });
    expect(mergeIntoOverride(view, {}, { groupBy: "owner" })).toEqual({
      groupBy: "owner",
    });
  });
});

describe("parseViewOverride", () => {
  it("reads nothing out of nothing", () => {
    expect(parseViewOverride(null)).toBeNull();
    expect(parseViewOverride("")).toBeNull();
    expect(parseViewOverride("{}")).toBeNull();
    expect(parseViewOverride("[1,2]")).toBeNull();
  });

  it("drops a filter nested past the depth the query builder allows", () => {
    let filter: unknown = {
      conjunction: "and",
      conditions: [{ propertyId: "status", operator: FilterOperator.IsEmpty }],
    };
    for (let depth = 0; depth < 6; depth++) {
      filter = { conjunction: "and", conditions: [filter] };
    }
    expect(parseViewOverride(JSON.stringify({ filter }))).toBeNull();
  });
});

describe("overrideFromLegacySettings", () => {
  it("reads nothing out of settings that were all unset", () => {
    expect(overrideFromLegacySettings({})).toBeNull();
    expect(
      overrideFromLegacySettings({
        hiddenProperties: [],
        filter: null,
        columnWidths: {},
        wrappedColumns: {},
      })
    ).toBeNull();
  });
});
