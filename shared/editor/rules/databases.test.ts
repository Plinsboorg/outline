import markdownit from "markdown-it";
import type { DataViewOverride } from "../../types";
import { FilterOperator, SummaryAggregation } from "../../types";
import { serializeViewOverride } from "../../utils/viewOverride";
import databases, { databaseHref, parseDatabaseHref } from "./databases";

const databaseId = "11111111-1111-4111-8111-111111111111";
const viewId = "22222222-2222-4222-8222-222222222222";
const propertyId = "33333333-3333-4333-8333-333333333333";
const propertyId2 = "44444444-4444-4444-8444-444444444444";

describe("databaseHref", () => {
  it("should round-trip through parseDatabaseHref", () => {
    expect(parseDatabaseHref(databaseHref(databaseId))).toEqual({
      databaseId,
      viewId: null,
      viewOverride: null,
    });
    expect(parseDatabaseHref(databaseHref(databaseId, viewId))).toEqual({
      databaseId,
      viewId,
      viewOverride: null,
    });
    // an override that changes nothing is not carried at all
    expect(
      parseDatabaseHref(databaseHref(databaseId, viewId, { viewOverride: {} }))
    ).toEqual({
      databaseId,
      viewId,
      viewOverride: null,
    });
  });

  it("should round-trip a whole view override", () => {
    const viewOverride: DataViewOverride = {
      columns: [
        { propertyId, visible: false },
        { propertyId: propertyId2, width: 140, wrap: true },
        { propertyId: "title", summary: SummaryAggregation.Count },
      ],
      columnOrder: ["title", propertyId2, propertyId],
      sorts: [{ propertyId: propertyId2, direction: "desc" }],
      filter: {
        conjunction: "and",
        conditions: [
          {
            propertyId,
            operator: FilterOperator.Contains,
            value: "needs, escaping&",
          },
        ],
      },
      groupBy: propertyId,
    };

    expect(
      parseDatabaseHref(databaseHref(databaseId, viewId, { viewOverride }))
    ).toEqual({ databaseId, viewId, viewOverride });
  });

  it("should read the settings older blocks carried separately", () => {
    const filter = {
      propertyId,
      operator: FilterOperator.Contains,
      value: "x",
    };
    const href =
      `database://${databaseId}/${viewId}?hidden=${propertyId}` +
      `&filter=${encodeURIComponent(JSON.stringify(filter))}` +
      `&widths=${encodeURIComponent(`title:220,${propertyId2}:140`)}` +
      `&wrap=${encodeURIComponent(`${propertyId}:1,${propertyId2}:0`)}`;

    expect(parseDatabaseHref(href)?.viewOverride).toEqual({
      columns: [
        { propertyId, visible: false, wrap: true },
        { propertyId: "title", width: 220 },
        { propertyId: propertyId2, width: 140, wrap: false },
      ],
      filter: { conjunction: "and", conditions: [filter] },
    });
  });

  it("should drop an override that is not usable", () => {
    const override = (value: unknown) =>
      parseDatabaseHref(
        `database://${databaseId}?v=${encodeURIComponent(
          JSON.stringify(value)
        )}`
      )?.viewOverride;

    expect(override({ columns: "nope", sorts: 4 })).toBeNull();
    expect(
      parseDatabaseHref(`database://${databaseId}?v=not-json`)?.viewOverride
    ).toBeNull();
    // a filter reaches the row query, so an unknown operator is not carried
    expect(
      override({
        filter: {
          conjunction: "and",
          conditions: [{ propertyId, operator: "sql-injection" }],
        },
      })
    ).toBeNull();
    // junk is dropped from around what is usable
    expect(
      override({
        columns: [
          { propertyId, width: -10 },
          { propertyId: propertyId2, visible: false },
        ],
        sorts: [{ propertyId, direction: "sideways" }],
      })
    ).toEqual({
      columns: [{ propertyId: propertyId2, visible: false }],
      sorts: [],
    });
  });

  it("should reject other hrefs", () => {
    expect(parseDatabaseHref("https://example.com")).toBeUndefined();
    expect(parseDatabaseHref("database://not-a-uuid")).toBeUndefined();
    expect(
      parseDatabaseHref(`database://${databaseId}/extra/junk`)
    ).toBeUndefined();
  });
});

describe("databases rule", () => {
  const md = markdownit().use(databases);

  it("should convert a database link paragraph to a database token", () => {
    const tokens = md.parse(
      `[Database](${databaseHref(databaseId, viewId)})`,
      {}
    );
    const token = tokens.find((item) => item.type === "database");
    expect(token).toBeDefined();
    expect(token?.attrGet("databaseId")).toEqual(databaseId);
    expect(token?.attrGet("viewId")).toEqual(viewId);
    expect(tokens.some((item) => item.type === "paragraph_open")).toBe(false);
  });

  it("should carry the view override onto the token", () => {
    const viewOverride: DataViewOverride = {
      columns: [{ propertyId, visible: false }],
    };
    const tokens = md.parse(
      `[Database](${databaseHref(databaseId, viewId, { viewOverride })})`,
      {}
    );
    const token = tokens.find((item) => item.type === "database");
    expect(token?.attrGet("viewOverride")).toEqual(
      serializeViewOverride(viewOverride)
    );
  });

  it("should leave regular links untouched", () => {
    const tokens = md.parse("[link](https://example.com)", {});
    expect(tokens.some((item) => item.type === "database")).toBe(false);
    expect(tokens.some((item) => item.type === "paragraph_open")).toBe(true);
  });

  it("should leave links with surrounding text untouched", () => {
    const tokens = md.parse(
      `before [Database](${databaseHref(databaseId)}) after`,
      {}
    );
    expect(tokens.some((item) => item.type === "database")).toBe(false);
  });
});
