import invariant from "invariant";
import { action, makeObservable, override, runInAction } from "mobx";
import type { DataView, JSONObject, Property } from "@shared/types";
import { mirroredRelationTargetIds } from "@shared/utils/properties";
import Database from "~/models/Database";
import type Document from "~/models/Document";
import type { Properties } from "~/types";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";

export default class DatabasesStore extends Store<Database> {
  constructor(rootStore: RootStore) {
    super(rootStore, Database);
    makeObservable(this);
  }

  /**
   * Creates a database at the given location — at a collection root or
   * nested under a parent document. The server creates the anchor document
   * that carries the database's identity alongside the facet.
   *
   * @param params the database attributes plus the location to create it at.
   * @param options extra request parameters.
   * @returns the created database.
   */
  @override
  create(
    params: Properties<Database> & {
      collectionId?: string;
      parentDocumentId?: string;
      name?: string;
    },
    options?: JSONObject
  ): Promise<Database> {
    return super.create(params, options);
  }

  /**
   * Loads every database the user can reach, optionally limited to one
   * collection.
   *
   * @param params the collection to limit results to, if any.
   * @returns the loaded databases.
   *
   * Not named `fetchAll`: the base store declares that as an annotated field,
   * and MobX 6 cannot redeclare one in a subclass — the field initializer
   * assigns over a property `makeObservable` has already sealed. It also reads
   * a different response shape than the base's paginated fetch.
   */
  @action
  loadAll = async (params?: {
    collectionId?: string;
    archived?: boolean;
  }): Promise<Database[]> => {
    this.isFetching = true;

    try {
      const res = await client.post("/databases.list", params);
      invariant(res?.data, "Data not available");

      let models: Database[] = [];
      runInAction(() => {
        models = res.data.map(this.add);
        this.addPolicies(res.policies);
        if (!params?.collectionId && !params?.archived) {
          this.isLoaded = true;
        }
      });
      return models;
    } finally {
      this.isFetching = false;
    }
  };

  /**
   * Returns the databases belonging to a collection, in creation order.
   *
   * @param collectionId the collection to filter by.
   * @returns the collection's databases.
   */
  inCollection = (collectionId: string): Database[] =>
    this.orderedData.filter(
      (database) =>
        database.collectionId === collectionId && !database.isArchived
    );

  /**
   * Saves a database's property schema, then reloads the databases on the far
   * side of any bidirectional relation.
   *
   * The server creates and removes those mirror properties itself and nothing
   * broadcasts the change, so the local copy of a related database goes stale
   * the moment a back link is added or dropped. That matters because a schema
   * write sends the whole schema: writing from a stale copy would resurrect a
   * mirror that was just deleted, or delete one that was just created.
   *
   * @param database the database whose schema to save.
   * @param dataSchema the schema to save.
   */
  @action
  saveSchema = async (
    database: Database,
    dataSchema: Property[]
  ): Promise<void> => {
    const affected = new Set([
      ...mirroredRelationTargetIds(database.dataSchema ?? []),
      ...mirroredRelationTargetIds(dataSchema),
    ]);
    affected.delete(database.id);

    await database.save({ dataSchema });

    await Promise.all(
      Array.from(affected).map(async (id) => {
        try {
          await this.fetch(id, { force: true });
        } catch (_err) {
          // the related database may have gone or be unreadable — its mirror
          // property is the server's business either way
        }
      })
    );
  };

  /**
   * Persists a change to one of a database's saved views, leaving the other
   * views untouched.
   *
   * @param database the database the view belongs to.
   * @param viewId the id of the view to change.
   * @param attrs the view attributes to merge in.
   */
  @action
  updateView = async (
    database: Database,
    viewId: string,
    attrs: Partial<DataView>
  ): Promise<void> => {
    const views = (database.views ?? []).map((view) =>
      view.id === viewId ? { ...view, ...attrs } : view
    );
    await database.save({ views });
  };

  /**
   * Moves a row to a new position in its database's manual order — and
   * optionally under a new parent row — applying the change locally straight
   * away and rolling it back if the request fails.
   *
   * @param database the database the row belongs to.
   * @param document the row to move.
   * @param index the fractional index to move the row to.
   * @param parentDocumentId the row to nest under; null moves to the top
   *   level, undefined keeps the current parent.
   * @throws if the row could not be moved.
   */
  @action
  moveRow = async (
    database: Database,
    document: Document,
    index: string,
    parentDocumentId?: string | null
  ): Promise<void> => {
    const previousIndex = document.databaseIndex;
    const previousParentId = document.parentDocumentId;
    document.databaseIndex = index;
    if (parentDocumentId !== undefined) {
      document.parentDocumentId = parentDocumentId ?? undefined;
    }

    try {
      await client.post("/databases.move_row", {
        id: database.id,
        documentId: document.id,
        index,
        ...(parentDocumentId !== undefined ? { parentDocumentId } : {}),
      });
    } catch (error) {
      runInAction(() => {
        document.databaseIndex = previousIndex;
        if (parentDocumentId !== undefined) {
          document.parentDocumentId = previousParentId;
        }
      });
      throw error;
    }
  };

  @override
  get orderedData(): Database[] {
    return Array.from(this.data.values()).sort((a, b) =>
      a.createdAt && b.createdAt
        ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
        : a.name.localeCompare(b.name)
    );
  }
}
