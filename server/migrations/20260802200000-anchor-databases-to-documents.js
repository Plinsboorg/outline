"use strict";

/**
 * Re-anchors databases from collections to documents. Every database gains an
 * anchor document sharing its id, which from now on carries the database's
 * identity (title, icon, color, full width, location, archived state). The
 * columns that duplicated document identity are dropped from databases.
 */

const EMPTY_CONTENT = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph" }],
});

const URL_ID_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomUrlId() {
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += URL_ID_CHARS[Math.floor(Math.random() * URL_ID_CHARS.length)];
  }
  return id;
}

function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      const [databases] = await queryInterface.sequelize.query(
        `SELECT * FROM databases WHERE "deletedAt" IS NULL`,
        { transaction }
      );

      for (const database of databases) {
        const urlId = randomUrlId();
        await queryInterface.sequelize.query(
          `INSERT INTO documents (
            id, "urlId", title, icon, color, "fullWidth", "collectionId",
            "teamId", "createdById", "lastModifiedById", "createdAt",
            "updatedAt", "publishedAt", "archivedAt", template, "isWelcome",
            "insightsEnabled", "popularityScore", properties, text, content,
            "revisionCount", "collaboratorIds"
          ) VALUES (
            :id, :urlId, :title, :icon, :color, :fullWidth, :collectionId,
            :teamId, :createdById, :createdById, :createdAt,
            :updatedAt, :createdAt, :archivedAt, false, false,
            true, 0, '{}', '', :content,
            0, ARRAY[:createdById]::uuid[]
          )`,
          {
            transaction,
            replacements: {
              id: database.id,
              urlId,
              title: database.name,
              icon: database.icon,
              color: database.color,
              fullWidth: database.fullWidth,
              collectionId: database.collectionId,
              teamId: database.teamId,
              createdById: database.createdById,
              createdAt: database.createdAt,
              updatedAt: database.updatedAt,
              archivedAt: database.archivedAt,
              content: EMPTY_CONTENT,
            },
          }
        );

        // active databases become visible sidebar documents, so they need a
        // node in their collection's document structure
        if (!database.archivedAt) {
          const [collections] = await queryInterface.sequelize.query(
            `SELECT id, "documentStructure" FROM collections WHERE id = :id FOR UPDATE`,
            { transaction, replacements: { id: database.collectionId } }
          );
          const collection = collections[0];
          if (collection) {
            const structure = collection.documentStructure || [];
            structure.push({
              id: database.id,
              url: `/doc/${slugify(database.name)}-${urlId}`,
              title: database.name,
              ...(database.icon ? { icon: database.icon } : {}),
              ...(database.color ? { color: database.color } : {}),
              children: [],
            });
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
        }
      }

      // soft-deleted databases have no anchor document; they cannot be reached
      // anyway, and keeping them would break the foreign key added below
      await queryInterface.sequelize.query(
        `DELETE FROM databases WHERE "deletedAt" IS NOT NULL`,
        { transaction }
      );

      // the anchor document owns the database's identity from here on: a hard
      // delete of the document cascades to the database, which in turn sets
      // the rows' databaseId to null via the existing constraint
      await queryInterface.sequelize.query(
        `ALTER TABLE databases
         ADD CONSTRAINT databases_id_fkey FOREIGN KEY (id)
         REFERENCES documents (id) ON DELETE CASCADE`,
        { transaction }
      );

      await queryInterface.removeColumn("databases", "name", { transaction });
      await queryInterface.removeColumn("databases", "icon", { transaction });
      await queryInterface.removeColumn("databases", "color", { transaction });
      await queryInterface.removeColumn("databases", "fullWidth", {
        transaction,
      });
      await queryInterface.removeColumn("databases", "collectionId", {
        transaction,
      });
      await queryInterface.removeColumn("databases", "archivedAt", {
        transaction,
      });
      await queryInterface.removeColumn("databases", "archivedById", {
        transaction,
      });
    });
  },

  async down(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "databases",
        "name",
        { type: Sequelize.STRING, allowNull: false, defaultValue: "Untitled" },
        { transaction }
      );
      await queryInterface.addColumn(
        "databases",
        "icon",
        { type: Sequelize.STRING, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        "databases",
        "color",
        { type: Sequelize.STRING, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        "databases",
        "fullWidth",
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction }
      );
      await queryInterface.addColumn(
        "databases",
        "collectionId",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: "collections", key: "id" },
          onDelete: "cascade",
        },
        { transaction }
      );
      await queryInterface.addColumn(
        "databases",
        "archivedAt",
        { type: Sequelize.DATE, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        "databases",
        "archivedById",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: "users", key: "id" },
          onDelete: "set null",
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `UPDATE databases SET
           name = documents.title,
           icon = documents.icon,
           color = documents.color,
           "fullWidth" = documents."fullWidth",
           "collectionId" = documents."collectionId",
           "archivedAt" = documents."archivedAt"
         FROM documents WHERE documents.id = databases.id`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE databases DROP CONSTRAINT databases_id_fkey`,
        { transaction }
      );

      // remove the anchor documents from their collections' structures, then
      // delete them — the database itself carries the identity again
      const [databases] = await queryInterface.sequelize.query(
        `SELECT id, "collectionId" FROM databases`,
        { transaction }
      );
      for (const database of databases) {
        const [collections] = await queryInterface.sequelize.query(
          `SELECT id, "documentStructure" FROM collections WHERE id = :id FOR UPDATE`,
          { transaction, replacements: { id: database.collectionId } }
        );
        const collection = collections[0];
        if (collection?.documentStructure) {
          const prune = (nodes) =>
            nodes
              .filter((node) => node.id !== database.id)
              .map((node) => ({ ...node, children: prune(node.children) }));
          await queryInterface.sequelize.query(
            `UPDATE collections SET "documentStructure" = :structure WHERE id = :id`,
            {
              transaction,
              replacements: {
                id: collection.id,
                structure: JSON.stringify(prune(collection.documentStructure)),
              },
            }
          );
        }
      }
      await queryInterface.sequelize.query(
        `DELETE FROM documents WHERE id IN (SELECT id FROM databases)`,
        { transaction }
      );
    });
  },
};
