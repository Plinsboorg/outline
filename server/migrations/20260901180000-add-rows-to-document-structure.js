"use strict";

/**
 * Adds database rows to the document structure of their collection, nested
 * under the document their database is anchored on. Rows were deliberately
 * kept out of it, which left them invisible to everything that reads the
 * tree — the API's collection listings, exports and any client walking it —
 * even though they are ordinary documents everywhere else.
 */

function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

/** Builds the node a row is represented by, with its sub-items beneath it. */
function toNode(row, childrenByParent) {
  return {
    id: row.id,
    url: `/doc/${slugify(row.title)}-${row.urlId}`,
    title: row.title,
    ...(row.icon ? { icon: row.icon } : {}),
    ...(row.color ? { color: row.color } : {}),
    databaseId: row.databaseId,
    children: (childrenByParent.get(row.id) || []).map((child) =>
      toNode(child, childrenByParent)
    ),
  };
}

/** Places each database's rows under its anchor node, wherever it sits. */
function addRows(nodes, rowsByDatabase) {
  return nodes.map((node) => {
    const rows = rowsByDatabase.get(node.id);
    const children = addRows(node.children || [], rowsByDatabase);
    return {
      ...node,
      children: rows ? [...rows, ...children] : children,
    };
  });
}

/** Drops every node that stands for a row, at any depth. */
function removeRows(nodes) {
  return nodes
    .filter((node) => !node.databaseId)
    .map((node) => ({
      ...node,
      children: removeRows(node.children || []),
    }));
}

module.exports = {
  async up(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      const [collections] = await queryInterface.sequelize.query(
        `SELECT id, "documentStructure" FROM collections
         WHERE "documentStructure" IS NOT NULL AND "deletedAt" IS NULL
         FOR UPDATE`,
        { transaction }
      );

      for (const collection of collections) {
        // rows read in the order their database arranges them, which is the
        // order the table and the sidebar both show
        const [rows] = await queryInterface.sequelize.query(
          `SELECT id, "urlId", title, icon, color, "databaseId",
                  "parentDocumentId"
           FROM documents
           WHERE "collectionId" = :collectionId
             AND "databaseId" IS NOT NULL
             AND "deletedAt" IS NULL
             AND "archivedAt" IS NULL
             AND "publishedAt" IS NOT NULL
           ORDER BY "databaseIndex" COLLATE "C" ASC, "createdAt" ASC`,
          { transaction, replacements: { collectionId: collection.id } }
        );

        if (rows.length === 0) {
          continue;
        }

        const childrenByParent = new Map();
        const topLevelByDatabase = new Map();
        const ids = new Set(rows.map((row) => row.id));

        for (const row of rows) {
          // a row whose parent is missing is shown at the top level of its
          // database rather than hidden, the same rule the views apply
          const parentId =
            row.parentDocumentId && ids.has(row.parentDocumentId)
              ? row.parentDocumentId
              : null;
          const list = parentId ? childrenByParent : topLevelByDatabase;
          const key = parentId ?? row.databaseId;
          if (list.has(key)) {
            list.get(key).push(row);
          } else {
            list.set(key, [row]);
          }
        }

        const rowsByDatabase = new Map();
        for (const [databaseId, topLevel] of topLevelByDatabase) {
          rowsByDatabase.set(
            databaseId,
            topLevel.map((row) => toNode(row, childrenByParent))
          );
        }

        const structure = addRows(
          removeRows(collection.documentStructure || []),
          rowsByDatabase
        );

        await queryInterface.sequelize.query(
          `UPDATE collections SET "documentStructure" = :structure WHERE id = :id`,
          {
            transaction,
            replacements: {
              id: collection.id,
              structure: JSON.stringify(structure),
            },
          }
        );
      }
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      const [collections] = await queryInterface.sequelize.query(
        `SELECT id, "documentStructure" FROM collections
         WHERE "documentStructure" IS NOT NULL AND "deletedAt" IS NULL
         FOR UPDATE`,
        { transaction }
      );

      for (const collection of collections) {
        const structure = removeRows(collection.documentStructure || []);
        await queryInterface.sequelize.query(
          `UPDATE collections SET "documentStructure" = :structure WHERE id = :id`,
          {
            transaction,
            replacements: {
              id: collection.id,
              structure: JSON.stringify(structure),
            },
          }
        );
      }
    });
  },
};
