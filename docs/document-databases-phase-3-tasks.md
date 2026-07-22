# Document Databases — Phase 3 tasks (More views & grouping)

Task breakdown for **Phase 3** of the document databases feature. Reads on top of
`docs/document-databases-spec.md` (see §4.5, §5.5, §6.2, §7). Phases 0–2 are done
(foundation → document properties → table view + inline block), completing the
Notion-database MVP. Phase 3 adds the remaining view types and grouping.

- **Status:** implemented 2026-07-22 (Board, List, Gallery — Calendar deliberately skipped, unused)
- **Prereq:** Phases 0–2 merged on `feat/document-databases`
- **Flag:** ships behind the existing document-databases feature flag

---

## Goal

Move beyond the single **table** view to the other Notion-style layouts, all driven
by a `groupBy` in the view config:

- **Board** (Kanban) — group rows by a `select` / `status` property; each option is a column.
- **List** — compact stacked rows.
- **Gallery** — card grid.
- **Calendar** — rows placed by a `date` property.

The data/view split from the spec holds: views stay saved queries over
`documents.properties`; no row data moves into the view. Group buckets are computed
at query time.

---

## Current state (grounding)

- `shared/types.ts` — `DataViewType` enum currently has only `Table` (~L578);
  `DataView.groupBy?: string` is **already declared** (~L617) but unused.
- `DataView` carries `columns`, `sorts`, `filter`, `groupBy` — the shape is ready;
  Phase 3 is mostly renderers + group-aware querying.
- Table view: `app/scenes/Collection/components/DatabaseTable.tsx`,
  `DatabaseTableFilter.tsx`; view-mode switch in `app/scenes/Collection/components/Navigation.tsx`.
- View query: `documents.list` (property filters + sorts landed in Phase 2, commit `e51464c39`).
- Inline block: `shared/editor/components/DatabaseBlock.tsx` (should learn the new view types).

---

## Tasks

### T1 — Shared types: view types + grouping
- Extend `DataViewType` in `shared/types.ts`: add `Board = "board"`, `List = "list"`,
  `Gallery = "gallery"`, `Calendar = "calendar"`.
- Confirm `groupBy` semantics: valid only for `Board` (MVP of grouping); document
  which property types are groupable (`select`, `multiSelect`, `status`).
- Add a `calendarBy?: string` (date property id) or reuse a convention for the
  Calendar view's date field — decide and document in the type JSDoc.
- Validation: reject a `groupBy`/date field that doesn't reference an existing
  property (mirror the existing view validation added in Phase 0/1).

### T2 — Server: group-aware view query
- Extend the `documents.list` view branch to accept the active view's `groupBy`
  and return rows bucketed by the group property (or return flat rows + a stable
  group key per row and let the client bucket — pick one; server-side bucketing
  keeps pagination correct per column).
- Handle the "no value" bucket (rows whose group property is empty).
- Multi-select grouping: a row can appear in multiple buckets — decide MVP
  behaviour (recommend: first option only for MVP, note the limitation).
- Calendar: support a date-range query window (month in view) filtered on the
  date property via the existing JSONB range predicate.
- Tests: group bucketing, empty bucket, date-window query, authorization unchanged.

### T3 — Client: Board view
- New `app/scenes/Collection/components/DatabaseBoard.tsx` — columns from the
  `groupBy` property's options (+ an "empty" column), cards = documents.
- Drag-a-card-between-columns updates that document's group property value via
  `documents.update({ properties })` (optimistic, MobX).
- Reuse the typed cell/field editors from the table view for card fields.
- Column ordering follows the property's option order.

### T4 — Client: List view
- `DatabaseList.tsx` — compact stacked rows reusing the row/cell renderers;
  honours `columns`, `sorts`, `filter`. Optional `groupBy` → section headers.

### T5 — Client: Gallery view
- `DatabaseGallery.tsx` — responsive card grid; card shows title + a configurable
  subset of properties. Reuse cell editors read-only on the card, full editor on open.

### T6 — Client: Calendar view
- `DatabaseCalendar.tsx` — month grid; place each document on its date-property day;
  navigate months (drives T2's date-window query). Click a day to create a doc with
  that date pre-filled.

### T7 — View switcher + per-view config UI
- Extend the collection view-mode switch (`Navigation.tsx`) to offer Board / List /
  Gallery / Calendar alongside Table.
- Per-view config UI: pick the `groupBy` property (Board), the date property
  (Calendar), visible card properties (Gallery). Persist onto the `DataView` via
  `collections.update({ views })`.

### T8 — Inline database block parity
- Teach `DatabaseBlock.tsx` (+ its editor node) to render the non-table view types
  by `viewId`, so an embedded database can show a board/list/gallery/calendar.

### T9 — State / stores
- Extend the collection/view MobX state for the active view type and its grouping
  config; computed helpers for grouped rows if the client buckets.

### T10 — Tests & polish
- Editor round-trip unchanged (inline block still serializes to its stable form).
- Mobile: horizontal scroll for board columns; responsive gallery grid (spec R6).
- Per-file Vitest runs (`yarn test path/to/file.test.ts`); no new test dirs.

---

## Sequencing

Board first (T1 → T2 → T3 → T7) — it exercises `groupBy` end-to-end and is the
highest-value non-table layout. Then List (cheap, reuses row renderers), then
Gallery, then Calendar (needs the date-window query). Inline-block parity (T8) and
store/test polish (T9/T10) fold in per view.

## Out of scope (later phases)

Relations (Phase 4), rollups (Phase 5), formulas (Phase 6). Grouping beyond a single
`groupBy` (nested groups), board swimlanes, and calendar multi-day spans are
post-Phase-3.

---

## Implementation notes (2026-07-22)

Shipped Board, List and Gallery. **Calendar was skipped intentionally** (unused
by the team); T1's `calendarBy` and T2/T6's date-window query were not built.

Decisions that differ from / refine the plan above:

- **Client-side bucketing (T2).** No server changes: the view query already
  supports property filters + sorts, and views fetch ≤100 flat rows. Bucketing
  happens in `groupByProperty()` (`shared/utils/properties.ts`), driven by
  MobX-observable document properties so drag-drop re-buckets instantly.
  Server-side bucketing (per-column pagination) deferred until row counts
  demand it.
- **Multi-select grouping** groups by the **first** option only (per the MVP
  recommendation). Dragging a card between board columns **replaces** the
  whole multiSelect value with the target option.
- **View switcher lives inside the database area** (`DatabaseView.tsx`), not
  as extra collection tabs; the collection tab was renamed Table → Database.
  The active layout is persisted per-user in localStorage; shared config
  (board `groupBy`) is persisted in `collection.views` via
  `collections.update({ views })`. Switching to a non-table layout lazily
  creates a saved `DataView` of that type so the inline block can reference
  it by id.
- **groupBy validation** now enforces groupable property types
  (select/multiSelect) in `validateDataView`, shared by client and server.
- **Inline block parity (T8)**: `DatabaseBlock` renders table/board/list/
  gallery read-only according to the saved view referenced by its existing
  `viewId` attr; when editable it shows a picker over the collection's saved
  views. No node-schema or serialization changes were needed.

Key files: `app/scenes/Collection/components/DatabaseView.tsx` (container),
`DatabaseBoard.tsx` / `DatabaseList.tsx` / `DatabaseGallery.tsx`,
`shared/editor/components/PropertyValueLabel.tsx` (shared read-only value
renderer), `shared/editor/components/DatabaseBlock.tsx`.
