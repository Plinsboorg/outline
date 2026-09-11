import markdownit from "markdown-it";
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
    });
    expect(parseDatabaseHref(databaseHref(databaseId, viewId))).toEqual({
      databaseId,
      viewId,
      hiddenProperties: [],
    });
    expect(
      parseDatabaseHref(
        databaseHref(databaseId, viewId, [propertyId, propertyId2])
      )
    ).toEqual({
      databaseId,
      viewId,
      hiddenProperties: [propertyId, propertyId2],
    });
    expect(
      parseDatabaseHref(databaseHref(databaseId, null, [propertyId]))
    ).toEqual({
      databaseId,
      viewId: null,
      hiddenProperties: [propertyId],
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
      `[Database](${databaseHref(databaseId, viewId, [propertyId, propertyId2])})`,
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
