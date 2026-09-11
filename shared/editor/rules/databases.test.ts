import markdownit from "markdown-it";
import { FilterOperator } from "../../types";
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
      hiddenProperties: [],
      filter: null,
      columnWidths: {},
    });
    expect(parseDatabaseHref(databaseHref(databaseId, viewId))).toEqual({
      databaseId,
      viewId,
      hiddenProperties: [],
      filter: null,
      columnWidths: {},
    });
    expect(
      parseDatabaseHref(
        databaseHref(databaseId, viewId, {
          hiddenProperties: [propertyId, propertyId2],
        })
      )
    ).toEqual({
      databaseId,
      viewId,
      hiddenProperties: [propertyId, propertyId2],
      filter: null,
      columnWidths: {},
    });
    expect(
      parseDatabaseHref(
        databaseHref(databaseId, null, { hiddenProperties: [propertyId] })
      )
    ).toEqual({
      databaseId,
      viewId: null,
      hiddenProperties: [propertyId],
      filter: null,
      columnWidths: {},
    });
  });

  it("should round-trip a filter and column widths", () => {
    const filter = {
      propertyId,
      operator: FilterOperator.Contains,
      value: "needs, escaping&",
    };
    const columnWidths = { title: 220, [propertyId]: 140 };

    expect(
      parseDatabaseHref(
        databaseHref(databaseId, viewId, { filter, columnWidths })
      )
    ).toEqual({
      databaseId,
      viewId,
      hiddenProperties: [],
      filter,
      columnWidths,
    });
  });

  it("should drop a filter that is not a usable condition", () => {
    const href = `database://${databaseId}?filter=${encodeURIComponent(
      JSON.stringify({ propertyId, operator: "sql-injection" })
    )}`;
    expect(parseDatabaseHref(href)?.filter).toBeNull();

    expect(
      parseDatabaseHref(`database://${databaseId}?filter=not-json`)?.filter
    ).toBeNull();
  });

  it("should drop column widths that are not positive numbers", () => {
    const href = `database://${databaseId}?widths=${encodeURIComponent(
      `title:0,${propertyId}:abc,${propertyId2}:120`
    )}`;
    expect(parseDatabaseHref(href)?.columnWidths).toEqual({
      [propertyId2]: 120,
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

  it("should carry hidden properties onto the token", () => {
    const tokens = md.parse(
      `[Database](${databaseHref(databaseId, viewId, {
        hiddenProperties: [propertyId, propertyId2],
      })})`,
      {}
    );
    const token = tokens.find((item) => item.type === "database");
    expect(token?.attrGet("hiddenProperties")).toEqual(
      `${propertyId},${propertyId2}`
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
