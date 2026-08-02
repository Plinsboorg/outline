import type { Database } from "@server/models";

export default function presentDatabase(database: Database) {
  return {
    id: database.id,
    titleName: database.titleName,
    dataSchema: database.dataSchema,
    views: database.views,
    createdAt: database.createdAt,
    updatedAt: database.updatedAt,
    // identity lives on the anchor document; these fields are presented from
    // it so pickers and the sidebar can label a database without a second
    // request for the document
    name: database.document?.title ?? "",
    icon: database.document?.icon ?? null,
    color: database.document?.color ?? null,
    collectionId: database.document?.collectionId ?? null,
    archivedAt: database.document?.archivedAt ?? null,
  };
}
