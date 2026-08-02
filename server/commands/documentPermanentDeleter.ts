import { chunk, uniq } from "es-toolkit/compat";
import { Op, QueryTypes } from "sequelize";
import { sleep } from "@shared/utils/timers";
import Logger from "@server/logging/Logger";
import { Database, Document, Attachment } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { RelationHelper } from "@server/models/helpers/RelationHelper";
import DeleteAttachmentTask from "@server/queues/tasks/DeleteAttachmentTask";
import { sequelize } from "@server/storage/database";

export default async function documentPermanentDeleter(documents: Document[]) {
  const activeDocument = documents.find((doc) => !doc.deletedAt);

  if (activeDocument) {
    throw new Error(
      `Cannot permanently delete ${activeDocument.id} document. Please delete it and try again.`
    );
  }

  const query = `
    SELECT COUNT(id)
    FROM documents
    WHERE "searchVector" @@ to_tsquery('english', :query) AND
    "teamId" = :teamId AND
    "id" != :documentId
  `;

  for (const document of documents) {
    // Find any attachments that are referenced in the text content
    const attachmentIdsInText = ProsemirrorHelper.parseAttachmentIds(
      DocumentHelper.toProsemirror(document)
    );

    // Find any attachments that were originally uploaded to this document
    const attachmentIdsForDocument = (
      await Attachment.findAll({
        attributes: ["id"],
        where: {
          teamId: document.teamId,
          documentId: document.id,
        },
      })
    ).map((attachment) => attachment.id);

    const attachmentIds = uniq([
      ...attachmentIdsInText,
      ...attachmentIdsForDocument,
    ]);

    await Promise.all(
      attachmentIds.map(async (attachmentId) => {
        // Check if the attachment is referenced in any other documents – this
        // is needed as it's easy to copy and paste content between documents.
        // An uploaded attachment may end up referenced in multiple documents.
        const [{ count }] = await sequelize.query<{ count: string }>(query, {
          type: QueryTypes.SELECT,
          replacements: {
            documentId: document.id,
            teamId: document.teamId,
            query: attachmentId,
          },
        });

        // If the attachment is not referenced in any other documents then
        // delete it from the database and the storage provider.
        if (parseInt(count) === 0) {
          Logger.info(
            "commands",
            `Attachment ${attachmentId} scheduled for deletion`
          );
          await new DeleteAttachmentTask().schedule({
            attachmentId,
            teamId: document.teamId,
          });
        }
      })
    );
  }

  const documentIds = documents.map((document) => document.id);

  // Re-check deletedAt in the database to exclude documents that were restored
  // between the caller's query and now. Otherwise the parentDocumentId clear
  // below would detach children of a restored parent, breaking the hierarchy.
  const stillDeleted = await Document.unscoped().findAll({
    attributes: ["id"],
    where: {
      id: documentIds,
      deletedAt: { [Op.ne]: null },
    },
    paranoid: false,
  });
  const deletedIds = stillDeleted.map((document) => document.id);

  for (const batch of chunk(deletedIds, 100)) {
    await Document.update(
      {
        parentDocumentId: null,
      },
      {
        where: {
          parentDocumentId: {
            [Op.in]: batch,
          },
        },
        paranoid: false,
      }
    );
  }

  // documents anchoring a database take the database with them — the facet is
  // removed by the foreign key cascade and the rows are detached by it, but
  // mirror properties this database created on other databases have to be
  // removed here, or they would point at a database that no longer exists
  const facets = await Database.findAll({
    where: { id: { [Op.in]: deletedIds } },
  });
  for (const facet of facets) {
    const previousSchema = facet.dataSchema;
    facet.dataSchema = [];
    try {
      await RelationHelper.syncInverseProperties(facet, previousSchema);
    } catch (error) {
      // a target database may itself be gone; that leaves nothing to clean
      Logger.warn("Failed to remove mirror properties", { error });
    }
  }

  // Small batch size and inter-batch sleep keep the exclusive lock window short
  // enough to avoid blocking concurrent web requests, since each delete
  // cascades into vectors, attachments, revisions, comments, and notifications.
  const destroyBatches = chunk(deletedIds, 10);

  let totalDeleted = 0;
  for (let i = 0; i < destroyBatches.length; i++) {
    totalDeleted += await Document.scope("withDrafts").destroy({
      where: {
        id: destroyBatches[i],
        deletedAt: { [Op.ne]: null },
      },
      force: true,
    });
    if (i < destroyBatches.length - 1) {
      await sleep(100);
    }
  }
  return totalDeleted;
}
