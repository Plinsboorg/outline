import type { Transaction } from "sequelize";
import { Op, Sequelize } from "sequelize";
import { buildRowTree } from "@shared/utils/rowTree";
import { Collection, Database, Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { RelationHelper } from "@server/models/helpers/RelationHelper";
import type { APIContext } from "@server/types";
import documentCreator from "./documentCreator";

type Props = {
  /** The document to duplicate */
  document: Document;
  /** The collection to add the duplicated document to */
  collection?: Collection | null;
  /** Override of the parent document to add the duplicate to */
  parentDocumentId?: string;
  /** Override of the duplicated document title */
  title?: string;
  /** Override of the duplicated document publish state */
  publish?: boolean;
  /** Whether to duplicate child documents */
  recursive?: boolean;
};

export default async function documentDuplicator(
  ctx: APIContext,
  { document, collection, parentDocumentId, title, publish, recursive }: Props
): Promise<Document[]> {
  const { transaction } = ctx.state;
  const newDocuments: Document[] = [];
  const sharedProperties = {
    collectionId: collection?.id,
    publish: publish ?? !!document.publishedAt,
  };

  // a copy of a row is a row of the same database, holding the same values —
  // and a sub-item copied on its own stays under the row it belongs to
  const isRowCopy = !parentDocumentId && !!document.databaseId;

  const duplicated = await documentCreator(ctx, {
    parentDocumentId: isRowCopy
      ? (document.parentDocumentId ?? undefined)
      : parentDocumentId,
    icon: document.icon,
    color: document.color,
    fullWidth: document.fullWidth,
    title: title ?? document.title,
    content: ProsemirrorHelper.removeMarks(
      DocumentHelper.toProsemirror(document),
      ["comment"]
    ),
    sourceMetadata: {
      ...document.sourceMetadata,
      originalDocumentId: document.id,
    },
    ...sharedProperties,
    ...(isRowCopy
      ? {
          databaseId: document.databaseId ?? undefined,
          properties: { ...document.properties },
          // a row that is not published is not returned by any row query, so
          // the copy is published whatever was asked for
          publish: true,
        }
      : {}),
  });

  duplicated.collection = collection ?? null;
  newDocuments.push(duplicated);

  // a database lives on its anchor document, so duplicating that document has
  // to duplicate the facet as well — without this the copy is an empty
  // document wearing a database icon. Its rows are its content rather than
  // nested documents, so they come along whether or not the copy is recursive.
  const facet = await Database.findByPk(document.id, { transaction });
  if (facet) {
    const copiedDatabase = await Database.create(
      {
        id: duplicated.id,
        dataSchema: facet.dataSchema,
        views: facet.views,
        titleName: facet.titleName,
        teamId: facet.teamId,
        createdById: ctx.state.auth.user.id,
      },
      { transaction }
    );
    // relations are held on both databases, so the copy's relation properties
    // give the databases they point at a property pointing back
    await RelationHelper.syncInverseProperties(copiedDatabase, [], {
      transaction,
    });

    newDocuments.push(
      ...(await duplicateRows(ctx, {
        rows: await rowsWhere({ databaseId: facet.id }, transaction),
        databaseId: copiedDatabase.id,
        collection,
        idMap: new Map(),
      }))
    );
  }

  const originalCollection = document?.collectionId
    ? await Collection.findByPk(document.collectionId, {
        attributes: {
          include: ["documentStructure"],
        },
      })
    : null;

  async function duplicateChildDocuments(
    original: Document,
    duplicatedDocument: Document
  ) {
    const childDocuments = await original.findChildDocuments(
      {
        archivedAt: original.archivedAt
          ? {
              [Op.ne]: null,
            }
          : {
              [Op.eq]: null,
            },
      },
      ctx
    );

    const sorted = DocumentHelper.sortDocumentsByStructure(
      childDocuments,
      originalCollection?.getDocumentTree(original.id)?.children ?? []
    ).reverse(); // we have to reverse since the child documents will be added in reverse order

    for (const childDocument of sorted) {
      const duplicatedChildDocument = await documentCreator(ctx, {
        parentDocumentId: duplicatedDocument.id,
        icon: childDocument.icon,
        color: childDocument.color,
        fullWidth: childDocument.fullWidth,
        title: childDocument.title,
        content: ProsemirrorHelper.removeMarks(
          DocumentHelper.toProsemirror(childDocument),
          ["comment"]
        ),
        sourceMetadata: {
          ...childDocument.sourceMetadata,
          originalDocumentId: childDocument.id,
        },
        ...sharedProperties,
      });

      duplicatedChildDocument.collection = collection ?? null;
      newDocuments.push(duplicatedChildDocument);
      await duplicateChildDocuments(childDocument, duplicatedChildDocument);
    }
  }

  // the sub-items of a row are rows themselves rather than nested documents,
  // so they are copied with it — a copy missing them would be a different row
  if (isRowCopy && document.databaseId) {
    const childIds = await document.findAllChildDocumentIds(undefined, {
      transaction,
    });
    const subItems = childIds.length
      ? await rowsWhere({ id: childIds }, transaction)
      : [];
    newDocuments.push(
      ...(await duplicateRows(ctx, {
        rows: subItems,
        databaseId: document.databaseId,
        collection,
        idMap: new Map([[document.id, duplicated.id]]),
      }))
    );
  } else if (recursive) {
    await duplicateChildDocuments(document, duplicated);
  }

  return newDocuments;
}

/**
 * Reads the live rows matching a condition, in the order a database lists
 * them: the manual arrangement first, then the rows never arranged by hand.
 */
async function rowsWhere(
  where: { databaseId: string } | { id: string[] },
  transaction?: Transaction
): Promise<Document[]> {
  return Document.unscoped().findAll({
    where: {
      ...where,
      deletedAt: null,
      archivedAt: null,
      publishedAt: { [Op.ne]: null },
    },
    order: [
      [Sequelize.literal(`"databaseIndex" collate "C"`), "ASC"],
      ["createdAt", "ASC"],
    ],
    transaction,
  });
}

/**
 * Copies rows into a database, parents before children so a sub-item can be
 * hung under the copy of its parent. Rows are appended in the order they are
 * created, which is the order they were read in, so the copy keeps the
 * arrangement of the original.
 */
async function duplicateRows(
  ctx: APIContext,
  {
    rows,
    databaseId,
    collection,
    idMap,
  }: {
    /** The rows to copy. */
    rows: Document[];
    /** The database the copies belong to. */
    databaseId: string;
    /** The collection the copies are created in. */
    collection?: Collection | null;
    /** Copies made already, keyed by the id of the row they were made from. */
    idMap: Map<string, string>;
  }
): Promise<Document[]> {
  const created: Document[] = [];
  const expanded = new Set(rows.map((row) => row.id));

  for (const row of buildRowTree(rows, expanded).visibleRows) {
    const copy = await documentCreator(ctx, {
      databaseId,
      parentDocumentId: row.parentDocumentId
        ? idMap.get(row.parentDocumentId)
        : undefined,
      properties: { ...row.properties },
      icon: row.icon,
      color: row.color,
      fullWidth: row.fullWidth,
      title: row.title,
      content: ProsemirrorHelper.removeMarks(
        DocumentHelper.toProsemirror(row),
        ["comment"]
      ),
      sourceMetadata: {
        ...row.sourceMetadata,
        originalDocumentId: row.id,
      },
      collectionId: collection?.id,
      // rows are only ever returned by a row query once published
      publish: true,
    });

    copy.collection = collection ?? null;
    idMap.set(row.id, copy.id);
    created.push(copy);
  }

  return created;
}
