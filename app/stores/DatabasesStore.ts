import invariant from "invariant";
import { action, computed, runInAction } from "mobx";
import type { DataView, JSONObject } from "@shared/types";
import Database from "~/models/Database";
import type Document from "~/models/Document";
import type { Properties } from "~/types";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";

export default class DatabasesStore extends Store<Database> {
  constructor(rootStore: RootStore) {
    super(rootStore, Database);
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
   */
  @action
  fetchAll = async (params?: {
    collectionId?: string;
    archived?: boolean;
  }): Promise<Database[]> => {
    this.isFetching = true;

    try {
      const res = await client.post("/databases.list", params);
      invariant(res?.data, "Data not available");

      let models: Database[] = [];
      runInAction("DatabasesStore#fetchAll", () => {
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
      runInAction("DatabasesStore#moveRow", () => {
        document.databaseIndex = previousIndex;
        if (parentDocumentId !== undefined) {
          document.parentDocumentId = previousParentId;
        }
      });
      throw error;
    }
  };

  @computed
  get orderedData(): Database[] {
    return Array.from(this.data.values()).sort((a, b) =>
      a.createdAt && b.createdAt
        ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
        : a.name.localeCompare(b.name)
    );
  }
}
