import { computed, observable } from "mobx";
import type { DataView, DataViewType, Property } from "@shared/types";
import type DatabasesStore from "~/stores/DatabasesStore";
import ParanoidModel from "~/models/base/ParanoidModel";
import Field from "./decorators/Field";

/**
 * A set of documents sharing a typed property schema. A database is anchored
 * to the document with the same id — that document carries the database's
 * identity (title, icon, location, starring, archived state), while this
 * model carries the schema and views. The identity fields here are read-only
 * projections from the anchor document; rename or move the document to change
 * them.
 */
export default class Database extends ParanoidModel {
  static modelName = "Database";

  store: DatabasesStore;

  /** The anchor document's title, presented by the server for labelling. */
  @observable
  name: string;

  /** The anchor document's icon (or emoji). */
  @observable
  icon: string | null;

  /** The color of the anchor document's icon. */
  @observable
  color: string | null;

  /** A custom display name for the title column; null means "Title". */
  @Field
  @observable
  titleName: string | null;

  /** The collection the anchor document belongs to. */
  @observable
  collectionId: string | null;

  /** The typed property definitions describing this database's columns. */
  @Field
  @observable.shallow
  dataSchema: Property[];

  /** Saved views over this database's rows. */
  @Field
  @observable.shallow
  views: DataView[];

  /** When the database was archived, hiding it and its rows. */
  @observable
  archivedAt: string | null;

  /** Whether the database is archived. */
  @computed
  get isArchived(): boolean {
    return !!this.archivedAt;
  }

  @computed
  get searchContent(): string {
    return this.name;
  }

  /** The anchor document, if it is loaded. */
  @computed
  get document() {
    return this.store.rootStore.documents.get(this.id);
  }

  /** The path to this database within the app — its anchor document's page. */
  @computed
  get path(): string {
    return this.document?.path ?? `/doc/${this.id}`;
  }

  /** The collection this database belongs to, if it is loaded. */
  @computed
  get collection() {
    return this.collectionId
      ? this.store.rootStore.collections.get(this.collectionId)
      : undefined;
  }

  /**
   * Returns the property definition with the given id.
   *
   * @param propertyId The property id to look up
   * @returns The property definition if found, else undefined.
   */
  getProperty(propertyId: string): Property | undefined {
    return this.dataSchema?.find((property) => property.id === propertyId);
  }

  /**
   * Returns the saved view with the given id.
   *
   * @param viewId The view id to look up
   * @returns The view if found, else undefined.
   */
  getView(viewId: string): DataView | undefined {
    return this.views?.find((view) => view.id === viewId);
  }

  /**
   * Resolves the view rows should be read through — the named view with the
   * given id, or the first saved view when that id is unknown.
   *
   * @param viewId The preferred view id, if any
   * @returns The resolved view, or undefined when the database has none.
   */
  resolveView(viewId?: string | null): DataView | undefined {
    return (viewId ? this.getView(viewId) : undefined) ?? this.views?.[0];
  }

  /**
   * Builds a new view over this database's schema, showing every property.
   *
   * @param type The layout of the new view
   * @param name The name of the new view
   * @param id The stable id of the new view
   * @returns The new view.
   */
  buildView(type: DataViewType, name: string, id: string): DataView {
    return {
      id,
      name,
      type,
      columns: (this.dataSchema ?? []).map((property) => ({
        propertyId: property.id,
        visible: true,
      })),
      sorts: [],
    };
  }
}
