import { randomUUID } from "node:crypto";
import {
  CollectionPermission,
  DataViewType,
  FilterOperator,
  PropertyType,
  RollupAggregation,
} from "@shared/types";
import { Database, Document, UserMembership } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildDatabase,
  buildDocument,
  buildTeam,
  buildUser,
  buildViewer,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

/** Builds a team with the feature enabled, plus a user and a collection. */
async function buildEnabledTeam() {
  const team = await buildTeam({ preferences: { documentDatabases: true } });
  const user = await buildUser({ teamId: team.id });
  const collection = await buildCollection({
    teamId: team.id,
    userId: user.id,
  });
  return { team, user, collection };
}

describe("#databases.create", () => {
  it("should create a database with a default view", async () => {
    const { user, collection } = await buildEnabledTeam();

    const res = await server.post("/api/databases.create", user, {
      body: { collectionId: collection.id, name: "Roadmap" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.name).toEqual("Roadmap");
    expect(body.data.collectionId).toEqual(collection.id);
    expect(body.data.views).toHaveLength(1);
    expect(body.data.dataSchema).toEqual([]);
  });

  it("should create an anchor document sharing the database's id", async () => {
    const { user, collection } = await buildEnabledTeam();

    const res = await server.post("/api/databases.create", user, {
      body: { collectionId: collection.id, name: "Roadmap" },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);

    const anchor = await Document.findByPk(body.data.id, {
      rejectOnEmpty: true,
    });
    expect(anchor.title).toEqual("Roadmap");
    expect(anchor.collectionId).toEqual(collection.id);
    expect(anchor.publishedAt).toBeTruthy();
  });

  it("should create a database nested under another document", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const parent = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/databases.create", user, {
      body: { parentDocumentId: parent.id, name: "Sub-database" },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);

    const anchor = await Document.findByPk(body.data.id, {
      rejectOnEmpty: true,
    });
    expect(anchor.parentDocumentId).toEqual(parent.id);
    expect(anchor.collectionId).toEqual(collection.id);
  });

  it("should allow several databases in one collection", async () => {
    const { user, collection } = await buildEnabledTeam();

    const first = await server.post("/api/databases.create", user, {
      body: { collectionId: collection.id, name: "First" },
    });
    const res = await server.post("/api/databases.create", user, {
      body: { collectionId: collection.id, name: "Second" },
    });
    expect(first.status).toEqual(200);
    expect(res.status).toEqual(200);

    const list = await (
      await server.post("/api/databases.list", user, {
        body: { collectionId: collection.id },
      })
    ).json();
    expect(list.data).toHaveLength(2);
  });

  it("should fail when the feature is disabled", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });

    const res = await server.post("/api/databases.create", user, {
      body: { collectionId: collection.id },
    });
    expect(res.status).toEqual(400);
  });

  it("should require write access to the collection", async () => {
    const { team, collection } = await buildEnabledTeam();
    const viewer = await buildViewer({ teamId: team.id });

    const res = await server.post("/api/databases.create", viewer, {
      body: { collectionId: collection.id },
    });
    expect(res.status).toEqual(403);
  });
});

describe("#databases.list", () => {
  it("should list the databases of a collection", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      name: "One",
    });
    await buildDatabase({ teamId: team.id, userId: user.id, name: "Other" });

    const res = await server.post("/api/databases.list", user, {
      body: { collectionId: collection.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toEqual("One");
  });

  it("should not list databases from another team", async () => {
    const { user } = await buildEnabledTeam();
    const otherTeam = await buildTeam({
      preferences: { documentDatabases: true },
    });
    await buildDatabase({ teamId: otherTeam.id, name: "Secret" });

    const res = await server.post("/api/databases.list", user, { body: {} });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(
      body.data.some((item: { name: string }) => item.name === "Secret")
    ).toBe(false);
  });

  it("should not list databases in private collections without membership", async () => {
    const { team, user } = await buildEnabledTeam();
    const owner = await buildUser({ teamId: team.id });
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: null,
    });
    await buildDatabase({
      teamId: team.id,
      userId: owner.id,
      collectionId: privateCollection.id,
      name: "Private",
    });

    const res = await server.post("/api/databases.list", user, { body: {} });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(
      body.data.some((item: { name: string }) => item.name === "Private")
    ).toBe(false);
  });

  it("should present write policies to a member of a private collection", async () => {
    const team = await buildTeam({ preferences: { documentDatabases: true } });
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
      permission: null,
    });
    await UserMembership.create({
      createdById: user.id,
      collectionId: collection.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
    });
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/databases.list", user, {
      body: { collectionId: collection.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(1);
    const abilities = body.policies.find(
      (policy: { id: string }) => policy.id === database.id
    )?.abilities;
    expect(abilities?.read).toBe(true);
    expect(abilities?.createRow).toBe(true);
    expect(abilities?.update).toBe(true);
  });
});

describe("#databases.update", () => {
  it("should update the schema and views", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const propertyId = randomUUID();

    const res = await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        dataSchema: [
          { id: propertyId, name: "Status", type: PropertyType.Text },
        ],
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.dataSchema).toHaveLength(1);
    expect(body.data.dataSchema[0].name).toEqual("Status");
  });

  it("should rename the title column", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/databases.update", user, {
      body: { id: database.id, titleName: "Task" },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.titleName).toEqual("Task");

    // clearing restores the default
    const cleared = await server.post("/api/databases.update", user, {
      body: { id: database.id, titleName: null },
    });
    expect((await cleared.json()).data.titleName).toBeNull();
  });

  it("should backfill auto numbers in creation order when enabled", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const propertyId = randomUUID();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      dataSchema: [{ id: propertyId, name: "ID", type: PropertyType.Number }],
    });
    const first = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });
    const second = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
    });

    const res = await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        dataSchema: [
          {
            id: propertyId,
            name: "ID",
            type: PropertyType.Number,
            config: { autoNumber: true },
          },
        ],
      },
    });
    expect(res.status).toEqual(200);

    await first.reload();
    await second.reload();
    expect(first.properties[propertyId]).toEqual(1);
    expect(second.properties[propertyId]).toEqual(2);

    // disabling clears the machine-assigned values
    await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        dataSchema: [{ id: propertyId, name: "ID", type: PropertyType.Number }],
      },
    });
    await first.reload();
    await second.reload();
    expect(first.properties[propertyId]).toBeUndefined();
    expect(second.properties[propertyId]).toBeUndefined();

    // re-enabling renumbers from the configured start
    const res2 = await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        dataSchema: [
          {
            id: propertyId,
            name: "ID",
            type: PropertyType.Number,
            config: { autoNumber: true, autoNumberStart: 100 },
          },
        ],
      },
    });
    expect(res2.status).toEqual(200);

    await first.reload();
    await second.reload();
    expect(first.properties[propertyId]).toEqual(100);
    expect(second.properties[propertyId]).toEqual(101);
  });

  it("should reject a view referencing an unknown property", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        views: [
          {
            id: randomUUID(),
            name: "Table",
            type: "table",
            columns: [{ propertyId: randomUUID(), visible: true }],
            sorts: [],
          },
        ],
      },
    });
    expect(res.status).toEqual(400);
  });

  it("should drop view references to a property removed from the schema", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const keptId = randomUUID();
    const removedId = randomUUID();
    const viewId = randomUUID();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      dataSchema: [
        { id: keptId, name: "Name", type: PropertyType.Text },
        {
          id: removedId,
          name: "Stage",
          type: PropertyType.Select,
          options: [],
        },
      ],
      views: [
        {
          id: viewId,
          name: "Table",
          type: DataViewType.Table,
          columns: [
            { propertyId: keptId, visible: true },
            { propertyId: removedId, visible: true },
          ],
          sorts: [{ propertyId: removedId, direction: "asc" }],
          filter: {
            conjunction: "and",
            conditions: [
              { propertyId: removedId, operator: FilterOperator.IsNotEmpty },
            ],
          },
          groupBy: removedId,
        },
      ],
    });

    // deleting a column sends the remaining schema, and nothing else — the
    // client cannot know the view still points at what it dropped
    const res = await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        dataSchema: [{ id: keptId, name: "Name", type: PropertyType.Text }],
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.dataSchema).toHaveLength(1);

    const view = body.data.views[0];
    expect(view.columns).toHaveLength(1);
    expect(view.columns[0].propertyId).toEqual(keptId);
    expect(view.sorts).toHaveLength(0);
    expect(view.filter).toBeFalsy();
    expect(view.groupBy).toBeFalsy();
  });

  it("should drop a rollup when the relation it walks is removed", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const target = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const relationId = randomUUID();
    const rollupId = randomUUID();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      dataSchema: [
        {
          id: relationId,
          name: "Area",
          type: PropertyType.Relation,
          config: { targetDatabaseId: target.id },
        },
        {
          id: rollupId,
          name: "How many",
          type: PropertyType.Rollup,
          config: {
            relationPropertyId: relationId,
            rollupAggregation: RollupAggregation.Count,
          },
        },
      ],
    });

    // the relation is deleted but the rollup is still sent, which is what
    // deleting the relation's column in the UI produces
    const res = await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        dataSchema: [
          {
            id: rollupId,
            name: "How many",
            type: PropertyType.Rollup,
            config: {
              relationPropertyId: relationId,
              rollupAggregation: RollupAggregation.Count,
            },
          },
        ],
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.dataSchema).toHaveLength(0);
  });

  it("should accept several views of the same type", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/databases.update", user, {
      body: {
        id: database.id,
        views: [
          {
            id: randomUUID(),
            name: "Mine",
            type: "table",
            columns: [],
            sorts: [],
          },
          {
            id: randomUUID(),
            name: "Everyone",
            type: "table",
            columns: [],
            sorts: [],
          },
        ],
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.views).toHaveLength(2);
  });

  it("should move the rows when the anchor document moves collection", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const destination = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    // a database is moved by moving its anchor document, like any document
    const res = await server.post("/api/documents.move", user, {
      body: { id: database.id, collectionId: destination.id },
    });
    expect(res.status).toEqual(200);

    await row.reload();
    expect(row.collectionId).toEqual(destination.id);
  });

  it("should create the mirror property for a bidirectional relation", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const source = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const target = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const relationId = randomUUID();
    const inverseId = randomUUID();

    const res = await server.post("/api/databases.update", user, {
      body: {
        id: source.id,
        dataSchema: [
          {
            id: relationId,
            name: "Linked",
            type: PropertyType.Relation,
            config: {
              targetDatabaseId: target.id,
              inversePropertyId: inverseId,
            },
          },
        ],
      },
    });
    expect(res.status).toEqual(200);

    await target.reload();
    expect(target.getProperty(inverseId)?.config?.targetDatabaseId).toEqual(
      source.id
    );
  });

  it("should require write access", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const viewer = await buildViewer({ teamId: team.id });

    const res = await server.post("/api/databases.update", viewer, {
      body: { id: database.id, titleName: "Nope" },
    });
    expect(res.status).toEqual(403);
  });
});

describe("#databases.move_row", () => {
  it("should persist the index of the moved row", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
      databaseIndex: "P",
    });

    const res = await server.post("/api/databases.move_row", user, {
      body: { id: database.id, documentId: row.id, index: "Q" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.success).toBe(true);

    await row.reload();
    expect(row.databaseIndex).toEqual("Q");
  });

  it("should order a row that has never been ordered", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });
    expect(row.databaseIndex).toBeFalsy();

    const res = await server.post("/api/databases.move_row", user, {
      body: { id: database.id, documentId: row.id, index: "P" },
    });
    expect(res.status).toEqual(200);

    await row.reload();
    expect(row.databaseIndex).toEqual("P");
  });

  it("should reject a row belonging to another database", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const other = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: other.id,
    });

    const res = await server.post("/api/databases.move_row", user, {
      body: { id: database.id, documentId: row.id, index: "P" },
    });
    expect(res.status).toEqual(400);

    await row.reload();
    expect(row.databaseIndex).toBeFalsy();
  });

  it("should reject a document that is not a row", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const document = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/databases.move_row", user, {
      body: { id: database.id, documentId: document.id, index: "P" },
    });
    expect(res.status).toEqual(400);
  });

  it("should require write access", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
      databaseIndex: "P",
    });
    const viewer = await buildViewer({ teamId: team.id });

    const res = await server.post("/api/databases.move_row", viewer, {
      body: { id: database.id, documentId: row.id, index: "Q" },
    });
    expect(res.status).toEqual(403);

    await row.reload();
    expect(row.databaseIndex).toEqual("P");
  });

  it("should reject an invalid index", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    // an index has to be there, has to be printable ASCII, and a trailing space
    // would break calculating an index next to it later on
    for (const index of ["", "P ", "P\n", "Pé", "P".repeat(257)]) {
      const res = await server.post("/api/databases.move_row", user, {
        body: { id: database.id, documentId: row.id, index },
      });
      expect(res.status).toEqual(400);
    }

    await row.reload();
    expect(row.databaseIndex).toBeFalsy();
  });

  it("should fail when the feature is disabled", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const database = await buildDatabase({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    const res = await server.post("/api/databases.move_row", user, {
      body: { id: database.id, documentId: row.id, index: "P" },
    });
    expect(res.status).toEqual(400);
  });
});

describe("row sub-items", () => {
  it("should create a row nested under another row of the same database", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const parent = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    const res = await server.post("/api/documents.create", user, {
      body: {
        title: "Sub-item",
        databaseId: database.id,
        parentDocumentId: parent.id,
        publish: true,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.parentDocumentId).toEqual(parent.id);
    expect(body.data.databaseId).toEqual(database.id);
  });

  it("should reject a parent row belonging to another database", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const other = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const foreignRow = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: other.id,
    });

    const res = await server.post("/api/documents.create", user, {
      body: {
        title: "Sub-item",
        databaseId: database.id,
        parentDocumentId: foreignRow.id,
        publish: true,
      },
    });
    expect(res.status).toEqual(400);
  });

  it("should infer the database when nesting under a row without one", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const parent = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    // this is what the ordinary "new nested document" paths send — no
    // databaseId at all — and it must still produce a visible sub-item
    const res = await server.post("/api/documents.create", user, {
      body: {
        title: "Sub-item",
        parentDocumentId: parent.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.databaseId).toEqual(database.id);
    expect(body.data.parentDocumentId).toEqual(parent.id);
    expect(body.data.publishedAt).toBeTruthy();
  });

  it("should create a row when nesting under the anchor document", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.create", user, {
      body: {
        title: "Row",
        parentDocumentId: database.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.databaseId).toEqual(database.id);
    expect(body.data.parentDocumentId).toBeNull();
    expect(body.data.publishedAt).toBeTruthy();
  });

  it("should not move a row on its own", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const destination = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: row.id, collectionId: destination.id },
    });
    expect(res.status).toEqual(400);
  });

  it("should treat the anchor document as no parent at all", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.create", user, {
      body: {
        title: "Row",
        databaseId: database.id,
        parentDocumentId: database.id,
        publish: true,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.parentDocumentId).toBeNull();
    expect(body.data.databaseId).toEqual(database.id);
  });

  it("should trash sub-items together with their parent row", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const parent = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });
    const child = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
      parentDocumentId: parent.id,
    });

    const res = await server.post("/api/documents.delete", user, {
      body: { id: parent.id },
    });
    expect(res.status).toEqual(200);

    const reloaded = await Document.findByPk(child.id, { paranoid: false });
    expect(reloaded?.deletedAt).toBeTruthy();
  });
});

describe("database lifecycle through the anchor document", () => {
  it("should trash the rows with the database and keep the facet", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    const res = await server.post("/api/documents.delete", user, {
      body: { id: database.id },
    });
    expect(res.status).toEqual(200);

    // trash is reversible, so the facet stays until the delete is permanent
    expect(await Database.findByPk(database.id)).toBeTruthy();

    const reloaded = await Document.findByPk(row.id, { paranoid: false });
    expect(reloaded?.deletedAt).toBeTruthy();
    expect(reloaded?.databaseId).toEqual(database.id);
  });

  it("should destroy the facet and detach the rows on permanent delete", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const propertyId = randomUUID();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      dataSchema: [{ id: propertyId, name: "Stage", type: PropertyType.Text }],
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });
    await row.update({ properties: { [propertyId]: "shipped" } });

    // permanent deletion is an admin operation
    const admin = await buildAdmin({ teamId: team.id });
    await server.post("/api/documents.delete", user, {
      body: { id: database.id },
    });
    const res = await server.post("/api/documents.delete", admin, {
      body: { id: database.id, permanent: true },
    });
    expect(res.status).toEqual(200);

    expect(await Database.findByPk(database.id)).toBeNull();

    // the row survives as an ordinary document, keeping its values — they are
    // keyed by property id and simply stop resolving
    const reloaded = await Document.findByPk(row.id, {
      paranoid: false,
      rejectOnEmpty: true,
    });
    expect(reloaded.databaseId).toBeNull();
    expect(reloaded.properties).toEqual({ [propertyId]: "shipped" });
  });

  it("should remove mirror properties from other databases on permanent delete", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const target = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const inverseId = randomUUID();
    const source = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      dataSchema: [
        {
          id: randomUUID(),
          name: "Linked",
          type: PropertyType.Relation,
          config: {
            targetDatabaseId: target.id,
            inversePropertyId: inverseId,
          },
        },
      ],
    });
    target.upsertProperty({
      id: inverseId,
      name: "Back",
      type: PropertyType.Relation,
      config: { targetDatabaseId: source.id },
    });
    await target.save();

    const admin = await buildAdmin({ teamId: team.id });
    await server.post("/api/documents.delete", user, {
      body: { id: source.id },
    });
    const res = await server.post("/api/documents.delete", admin, {
      body: { id: source.id, permanent: true },
    });
    expect(res.status).toEqual(200);

    await target.reload();
    expect(target.getProperty(inverseId)).toBeUndefined();
  });

  it("should archive the rows with the database, then restore both", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    const row = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      databaseId: database.id,
    });

    const archived = await server.post("/api/documents.archive", user, {
      body: { id: database.id },
    });
    expect(archived.status).toEqual(200);

    // gone from the active list, and its rows with it
    const list = await (
      await server.post("/api/databases.list", user, {
        body: { collectionId: collection.id },
      })
    ).json();
    expect(list.data).toHaveLength(0);

    const rows = await (
      await server.post("/api/documents.list", user, {
        body: { databaseId: database.id },
      })
    ).json();
    expect(rows.data).toHaveLength(0);

    // the row keeps everything that made it a row
    await row.reload({ paranoid: false });
    expect(row.databaseId).toEqual(database.id);
    expect(row.archivedAt).toBeTruthy();

    const restored = await server.post("/api/documents.restore", user, {
      body: { id: database.id },
    });
    expect(restored.status).toEqual(200);

    const after = await (
      await server.post("/api/databases.list", user, {
        body: { collectionId: collection.id },
      })
    ).json();
    expect(after.data).toHaveLength(1);

    await row.reload();
    expect(row.archivedAt).toBeNull();
  });

  it("should list archived databases only when asked", async () => {
    const { team, user, collection } = await buildEnabledTeam();
    const database = await buildDatabase({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
    });
    await server.post("/api/documents.archive", user, {
      body: { id: database.id },
    });

    const res = await server.post("/api/databases.list", user, {
      body: { collectionId: collection.id, archived: true },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toEqual(database.id);
  });
});
