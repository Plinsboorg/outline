import type { Property } from "@shared/types";
import { TextEditMode } from "@shared/types";
import { InvalidRequestError } from "@server/errors";
import { Database, Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import type { APIContext } from "@server/types";

type Props = {
  /** The document being moved, with its changes not yet saved. */
  document: Document;
  /** The database it belongs to after the move; null takes it out of one. */
  databaseId: string | null;
};

/**
 * Moves a document into or out of a database, along with everything nested
 * under it — a document dropped onto a database becomes one of its rows, and
 * dragging a row away makes it an ordinary document again.
 *
 * Joining a database gives a document the empty set of property values every
 * row has. Leaving one takes those values away, so they are first written into
 * the body of the document as text: the property columns of one database mean
 * nothing in another, and nothing at all outside one, but what was recorded in
 * them should not vanish.
 *
 * The moved document itself is left unsaved for the caller to save, since it
 * is on its way through documentMover; everything nested under it is saved
 * here.
 *
 * @param ctx The API context
 * @param Props The document and the database it is moving to
 * @throws InvalidRequestError if a database is being moved into a database
 */
export default async function documentDatabaseTransfer(
  ctx: APIContext,
  { document, databaseId }: Props
): Promise<void> {
  const { transaction } = ctx.state;
  const previousDatabaseId = document.databaseId ?? null;

  if (previousDatabaseId === databaseId) {
    return;
  }

  if (databaseId) {
    // a database's own rows are reached through its anchor document, so
    // nesting one database inside another would leave two databases claiming
    // the same rows
    const facet = await Database.findByPk(document.id, {
      attributes: ["id"],
      transaction,
    });
    if (facet) {
      throw InvalidRequestError(
        "A database cannot be moved inside another database"
      );
    }
  }

  const childDocumentIds = await document.findAllChildDocumentIds(undefined, {
    transaction,
  });
  const children = childDocumentIds.length
    ? await Document.findAll({
        where: { id: childDocumentIds },
        transaction,
      })
    : [];

  // the values are read against the schema of the database being left, which
  // is not always the one the moved document belongs to — a sub-item can only
  // come from the same database as its parent, but that is worth not assuming
  const schemas = new Map<string, Property[]>();

  for (const doc of [document, ...children]) {
    const leaving = doc.databaseId ?? null;
    if (leaving && leaving !== databaseId) {
      let schema = schemas.get(leaving);
      if (!schema) {
        schema =
          (await Database.findByPk(leaving, { transaction }))?.dataSchema ?? [];
        schemas.set(leaving, schema);
      }
      const backup = DocumentHelper.propertiesToMarkdown(doc, schema);
      if (backup) {
        DocumentHelper.applyMarkdownToDocument(
          doc,
          backup,
          TextEditMode.Append
        );
      }
      doc.properties = {};
    }

    doc.databaseId = databaseId;
    // only the moved document is placed in the order; what hangs beneath it
    // keeps its own arrangement, and rows without an index sort last
    doc.databaseIndex =
      databaseId && doc.id === document.id
        ? await Document.nextDatabaseIndex(databaseId, transaction)
        : null;

    if (doc.id !== document.id) {
      await doc.save({ transaction });
    }
  }
}
