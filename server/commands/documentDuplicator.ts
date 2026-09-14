import { randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { Op, Sequelize } from "sequelize";
import { buildRowTree } from "@shared/utils/rowTree";
import { Collection, Database, Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import type { DocumentReference } from "@server/models/helpers/ProsemirrorHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { RelationHelper } from "@server/models/helpers/RelationHelper";
import type { APIContext } from "@server/types";
import { generateUrlId } from "@server/utils/url";
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

type ManyProps = {
  /** The documents to duplicate, in the order they should be created */
  documents: Document[];
  /** The collection to add the duplicated documents to */
  collection?: Collection | null;
  /** Override of the duplicated documents publish state */
  publish?: boolean;
  /** Whether to duplicate child documents */
  recursive?: boolean;
};

/** A document to duplicate, and where its duplicate should be placed. */
type Root = {
  /** The document to duplicate */
  document: Document;
  /** Override of the duplicated document title */
  title?: string;
  /** Override of the parent document to add the duplicate to */
  parentDocumentId?: string;
};

/** A document to duplicate, with the identifiers assigned to its duplicate. */
type DuplicateItem = {
  /** The document being duplicated */
  original: Document;
  /** The id assigned to the duplicate */
  id: string;
  /** The url identifier assigned to the duplicate */
  urlId: string;
  /** The title of the duplicate */
  title: string;
  /** The children to duplicate under the duplicate */
  children: DuplicateItem[];
};

/**
 * Duplicates a document, optionally including its child documents. Links
 * between the duplicated documents are remapped to point at the copies.
 *
 * @param ctx the API context containing the acting user and transaction.
 * @param props the document to duplicate and optional overrides.
 * @returns the duplicated documents.
 */
export default async function documentDuplicator(
  ctx: APIContext,
  { document, collection, parentDocumentId, title, publish, recursive }: Props
): Promise<Document[]> {
  return duplicateRoots(ctx, {
    roots: [{ document, title, parentDocumentId }],
    collection,
    publish,
    recursive,
  });
}

/**
 * Duplicates several documents as one unit, so that links between them are
 * remapped to the copies no matter which of the documents they cross between.
 *
 * @param ctx the API context containing the acting user and transaction.
 * @param props the documents to duplicate and optional overrides.
 * @returns the duplicated documents.
 */
export async function documentsDuplicator(
  ctx: APIContext,
  { documents, collection, publish, recursive }: ManyProps
): Promise<Document[]> {
  return duplicateRoots(ctx, {
    roots: documents.map((document) => ({ document })),
    collection,
    publish,
    recursive,
  });
}

async function duplicateRoots(
  ctx: APIContext,
  {
    roots,
    collection,
    publish,
    recursive,
  }: {
    roots: Root[];
    collection?: Collection | null;
    publish?: boolean;
    recursive?: boolean;
  }
): Promise<Document[]> {
  const { transaction } = ctx.state;
  const newDocuments: Document[] = [];
  const references = new Map<string, DocumentReference>();
  const originalCollections = new Map<string, Collection | null>();

  async function originalCollectionFor(original: Document) {
    const collectionId = original.collectionId;
    if (!collectionId) {
      return null;
    }
    if (!originalCollections.has(collectionId)) {
      originalCollections.set(
        collectionId,
        await Collection.findByPk(collectionId, {
          attributes: {
            include: ["documentStructure"],
          },
        })
      );
    }
    return originalCollections.get(collectionId) ?? null;
  }

  async function buildItem(
    original: Document,
    originalCollection: Collection | null,
    titleOverride?: string,
    skipChildren = false
  ): Promise<DuplicateItem> {
    const id = randomUUID();
    const urlId = generateUrlId();
    const itemTitle = titleOverride ?? original.title;

    const reference = {
      id,
      path: Document.getPath({ title: itemTitle, urlId }),
    };
    references.set(original.id, reference);
    references.set(original.urlId, reference);

    return {
      original,
      id,
      urlId,
      title: itemTitle,
      children:
        recursive && !skipChildren
          ? await buildChildItems(original, originalCollection)
          : [],
    };
  }

  async function buildChildItems(
    original: Document,
    originalCollection: Collection | null
  ) {
    // Structural fields only – content is re-fetched per document in
    // `duplicateItem`, so a large tree isn't held in memory at once.
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
      {
        ...ctx,
        attributes: { exclude: ["state", "content", "text"] },
      }
    );

    const sorted = DocumentHelper.sortDocumentsByStructure(
      childDocuments,
      originalCollection?.getDocumentTree(original.id)?.children ?? []
    ).reverse(); // we have to reverse since the child documents will be added in reverse order

    const items: DuplicateItem[] = [];
    for (const childDocument of sorted) {
      items.push(await buildItem(childDocument, originalCollection));
    }
    return items;
  }

  async function duplicateItem(
    item: DuplicateItem,
    options: {
      parentDocumentId?: string;
      publish: boolean;
      /** Set when the duplicate is itself a row of this database. */
      databaseId?: string;
    }
  ) {
    const original =
      item.original.dataValues.content !== undefined
        ? item.original
        : await Document.findByPk(item.original.id, {
            transaction: ctx.state.transaction,
            rejectOnEmpty: true,
          });

    const duplicated = await documentCreator(ctx, {
      id: item.id,
      urlId: item.urlId,
      parentDocumentId: options.parentDocumentId,
      publish: options.publish,
      collectionId: collection?.id,
      icon: original.icon,
      color: original.color,
      fullWidth: original.fullWidth,
      preferences: original.preferences,
      title: item.title,
      content: ProsemirrorHelper.replaceDocumentReferences(
        ProsemirrorHelper.removeMarks(DocumentHelper.toProsemirror(original), [
          "comment",
        ]),
        references
      ),
      sourceMetadata: {
        ...original.sourceMetadata,
        originalDocumentId: original.id,
      },
      // a copy of a row is a row of the same database, holding the same values
      ...(options.databaseId
        ? {
            databaseId: options.databaseId,
            properties: { ...original.properties },
            // a row that is not published is not returned by any row query, so
            // the copy is published whatever was asked for
            publish: true,
          }
        : {}),
    });

    duplicated.collection = collection ?? null;
    newDocuments.push(duplicated);

    for (const child of item.children) {
      await duplicateItem(child, {
        ...options,
        parentDocumentId: duplicated.id,
      });
    }
  }

  // A copy of a row is a row of the same database, and a sub-item copied on
  // its own stays under the row it belongs to. Its sub-items are rows too, so
  // they are copied by `duplicateRows` rather than as nested documents — which
  // is why these roots skip the ordinary child walk.
  const rowCopies = roots.map(
    (root) => !root.parentDocumentId && !!root.document.databaseId
  );

  // The identifiers of every duplicate are assigned before any content is
  // written so that links between the documents being duplicated can be
  // remapped to the copies, leaving the duplicate self-contained.
  const items: DuplicateItem[] = [];
  for (const [index, root] of roots.entries()) {
    items.push(
      await buildItem(
        root.document,
        await originalCollectionFor(root.document),
        root.title,
        rowCopies[index]
      )
    );
  }

  for (const [index, item] of items.entries()) {
    const root = roots[index];
    const isRowCopy = rowCopies[index];

    await duplicateItem(item, {
      parentDocumentId: isRowCopy
        ? (root.document.parentDocumentId ?? undefined)
        : root.parentDocumentId,
      publish: publish ?? !!root.document.publishedAt,
      databaseId: isRowCopy ? (root.document.databaseId ?? undefined) : undefined,
    });

    await duplicateDatabaseFacet(ctx, {
      original: root.document,
      duplicatedId: item.id,
      collection,
      newDocuments,
    });

    // the sub-items of a row are rows themselves rather than nested documents,
    // so they are copied with it — a copy missing them would be a different row
    if (isRowCopy && root.document.databaseId) {
      const childIds = await root.document.findAllChildDocumentIds(undefined, {
        transaction,
      });
      const subItems = childIds.length
        ? await rowsWhere({ id: childIds }, transaction)
        : [];
      newDocuments.push(
        ...(await duplicateRows(ctx, {
          rows: subItems,
          databaseId: root.document.databaseId,
          collection,
          idMap: new Map([[root.document.id, item.id]]),
        }))
      );
    }
  }

  return newDocuments;
}

/**
 * A database lives on its anchor document, so duplicating that document has to
 * duplicate the facet as well — without this the copy is an empty document
 * wearing a database icon. Its rows are its content rather than nested
 * documents, so they come along whether or not the copy is recursive.
 */
async function duplicateDatabaseFacet(
  ctx: APIContext,
  {
    original,
    duplicatedId,
    collection,
    newDocuments,
  }: {
    /** The document being duplicated, which may anchor a database. */
    original: Document;
    /** The id assigned to its duplicate. */
    duplicatedId: string;
    /** The collection the copies are created in. */
    collection?: Collection | null;
    /** Collects the documents created here. */
    newDocuments: Document[];
  }
) {
  const { transaction } = ctx.state;
  const facet = await Database.findByPk(original.id, { transaction });
  if (!facet) {
    return;
  }

  const copiedDatabase = await Database.create(
    {
      id: duplicatedId,
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
