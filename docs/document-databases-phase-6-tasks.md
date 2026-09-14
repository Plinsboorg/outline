# Document Databases — Phase 6 (standalone databases, bidirectional relations, named views, summaries)

Implementation log for **Phase 6**. Reads on top of `docs/document-databases-spec.md`
and `docs/document-databases-phase-3-tasks.md`.

- **Status:** implemented 2026-07-28
- **Prereq:** Phases 0–5 (PR #2)
- **Flag:** ships behind the existing `TeamPreference.DocumentDatabases` flag

Scope was chosen by contrasting what we had built against the speculative
designs in upstream discussion
[outline/outline#8476](https://github.com/outline/outline/discussions/8476).
Four of that thread's ideas were adopted; the thread's headline ask — a
level‑5 no-code RDBMS backed by real Postgres tables — was deliberately not,
because it would give up the search, backlinks, permissions and versioning that
rows get for free by being ordinary Outline documents.

---

## 1. Databases are scoped under a collection

Previously a collection **was** a database: `collections.dataSchema` non-null
meant "this collection is a database". That allowed exactly one database per
collection, no nesting, and no way to move a database between collections.

Now a database is its own model, owned by a collection.

- **Migration** `20260728120000-create-databases.js` — creates `databases`,
  adds `documents.databaseId`, backfills one database per database-collection,
  rewrites relation `config.targetCollectionId` → `targetDatabaseId`, then drops
  `collections.dataSchema` / `collections.views`. Reversible.
- **Model** `server/models/Database.ts` — `name`, `icon`, `color`,
  `dataSchema`, `views`, `collectionId`, `teamId`, `createdById`; paranoid.
  Property/view helpers moved here from `Collection`.
- **Rows** are documents with `databaseId` set. They keep their `collectionId`,
  so document authorization, search and sharing are unchanged.
- **Policy** `server/policies/database.ts` — read/update/delete/createRow all
  delegate to the parent collection, exactly as document policies do. No new
  authorization model.
- **Sidebar** — rows are deliberately kept out of `collection.documentStructure`
  (`Collection.addDocumentToStructure` returns early for rows), so a
  thousand-row database does not flood the sidebar. Databases themselves are
  listed under their collection by `DatabaseLink`.
- **Routes** `server/routes/api/databases/` — `list`, `info`, `create`,
  `update`, `delete`. `databases.update` accepts a new `collectionId`, which
  moves the database **and its rows** together.
- **Deleting a database keeps its rows.** They lose `databaseId` and their
  property values, and are put back into the collection's document structure —
  otherwise they would exist but be unreachable from the sidebar.
- **Client** — `app/models/Database.ts`, `app/stores/DatabasesStore.ts`,
  scene at `/database/:id`, actions in `app/actions/definitions/databases.tsx`.
  The collection scene's "Database" tab is gone.

**Known behaviour change:** existing inline database blocks referenced a
collection (`data-collection-id`); the attribute is now `data-database-id`.
Blocks written before this phase render the "choose a database" picker again.

## 2. Bidirectional relations

A relation property may name an `inversePropertyId`. When it does, the server
maintains a mirror relation property on the target database, and writing one
side writes the other.

- `server/models/helpers/RelationHelper.ts`
  - `syncInverseProperties` — creates and removes mirrors when a schema changes;
    called from `databases.create`, `databases.update` and `databases.delete`.
    A mirror that has been renamed keeps its name. Cross-team targets are
    rejected. A database may point a relation at itself.
  - `syncInverseValues` — mirrors a row's added/removed links onto the rows it
    references. Called from `documents.update` when `properties` change.
  - `clearInverseValues` — drops back-references to a row.
- `PropertyConfig` also gained `limitToViewId` (restrict which rows may be
  linked to those matching a saved view) and `allowMultiple` (single-valued
  relations), both from the thread's NocoDB/Teable mockups.
- Relations now **require** a `targetDatabaseId`; "any collection" is gone.

## 3. Named views

`DataView` already carried a stable `id` and `name`, but the client keyed views
by *type* (`Collection.viewOfType`), so a database had at most one table, one
board, and so on.

- A database may now hold any number of views, including several of the same
  type. `DatabaseViewTabs` renders them as a tab bar with add / rename
  (double-click) / delete.
- Sort, filter, grouping and column visibility are now **stored on the active
  view** rather than held in component state, so switching tabs switches the
  whole query rather than only the layout.
- A database is created with one default table view over every property.

## 4. Column summaries

Per-column footer aggregates: count, filled, empty, unique, sum, average, min,
max. Numeric aggregations are offered only for number properties; `unique` is
not offered for multi-select or relation, where it would count combinations
rather than values; rollups cannot be summarised at all.

- `server/models/helpers/SummaryHelper.ts` builds one aggregate query using the
  **same WHERE clause as the row query**, so a summary describes every row
  matching the view's filter, not just the loaded page.
- Requested through `documents.list` via `summariesForViewId`; returned as a
  `summaries` map alongside `data`.
- Numeric reductions guard on `jsonb_typeof` so a value left behind by a
  property type change cannot raise a cast error.

---

## Testing

New: `server/models/Database.test.ts`,
`server/models/helpers/RelationHelper.test.ts`,
`server/models/helpers/SummaryHelper.test.ts`,
`server/routes/api/databases/databases.test.ts`,
`server/presenters/database.test.ts`.

Updated for the new model: `Collection.test.ts` (database cases removed),
`Document.test.ts`, `DocumentHelper.test.ts`, `RollupHelper.test.ts`,
`document.test.ts`, `RelationsProcessor.test.ts`, `documents.test.ts`,
`shared/utils/properties.test.ts`, `shared/editor/rules/databases.test.ts`.
`server/presenters/collection.test.ts` was removed — it only covered the moved
fields.

## Not done, and why

- **Formulas.** Still the largest gap versus Notion and the one most named in
  the upstream thread. Column summaries cover the common "total this column"
  case without a expression language.
- **Filtering or sorting by a rollup.** `PropertyQueryHelper` rejects it;
  rollups are computed per page after the query runs.
- **Deleting a row does not clear back-references automatically.**
  `clearInverseValues` exists and is tested but is not yet wired into the
  document delete path. Stale ids are harmless — they resolve to nothing.
- **Level‑5 RDBMS / external Postgres data source.** Out of scope by choice;
  see the note at the top.
