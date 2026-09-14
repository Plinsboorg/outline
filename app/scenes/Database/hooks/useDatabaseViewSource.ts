import * as React from "react";
import { toast } from "sonner";
import type { DataView, DataViewOverride, FilterGroup } from "@shared/types";
import { errToString } from "@shared/utils/error";
import {
  applyViewOverride,
  baseFilterForOverride,
  mergeIntoOverride,
} from "@shared/utils/viewOverride";
import type Database from "~/models/Database";
import usePersistedState from "~/hooks/usePersistedState";

/**
 * Where a rendered database view reads its configuration from, and where
 * changes to it are written back to.
 *
 * The database page renders its views straight from the database, so a change
 * to a view is saved on the database and everyone sees it. An embedded
 * database block renders the same views through an override stored on the
 * block, so a change made there belongs to that one embed. Everything else
 * about rendering a view — the rows, the layouts, the property menus — is the
 * same either way, and reads the view through this.
 */
export type DatabaseViewSource = {
  /** The saved views this surface offers, in order. */
  views: DataView[];
  /** The view to render, as configured for this surface. */
  view?: DataView;
  /**
   * A filter narrowing the query beneath the rendered view's own, which the
   * view's filter controls do not edit. Set where the rendered view is an
   * override of a saved view: the saved view's filter still applies, and the
   * override can only narrow it further.
   */
  baseFilter?: FilterGroup;
  /** Render a different saved view. */
  selectView: (viewId: string) => void;
  /** Persist a change to the rendered view. */
  updateView: (attrs: Partial<DataView>) => void;
};

/**
 * Reads and writes a database's saved views directly, remembering which one
 * was last looked at. This is the source the database page uses: edits to the
 * view are saved on the database, so they apply wherever it is rendered.
 *
 * @param database the database being rendered.
 * @returns the view source.
 */
export function useSavedViewSource(database: Database): DatabaseViewSource {
  const [persistedViewId, setPersistedViewId] = usePersistedState<
    string | undefined
  >(`database-view:${database.id}`, undefined);

  const view = database.resolveView(persistedViewId);
  const viewId = view?.id;

  const updateView = React.useCallback(
    async (attrs: Partial<DataView>) => {
      if (!viewId) {
        return;
      }
      const views = (database.views ?? []).map((item) =>
        item.id === viewId ? { ...item, ...attrs } : item
      );
      try {
        await database.save({ views });
      } catch (error) {
        toast.error(errToString(error));
      }
    },
    [database, viewId]
  );

  const views = database.views ?? [];
  const viewsKey = views.map((item) => item.id).join(",");

  return React.useMemo(
    () => ({
      views,
      view,
      selectView: setPersistedViewId,
      updateView: (attrs: Partial<DataView>) => void updateView(attrs),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewsKey, view, setPersistedViewId, updateView]
  );
}

type OverriddenSourceOptions = {
  /** The saved views this surface offers; every one of the database's own
   * when not restricted. */
  views: DataView[];
  /** The saved view being rendered through, if chosen. */
  viewId?: string | null;
  /** How this surface's rendering differs from that view. */
  override?: DataViewOverride | null;
  /** Callback choosing a different saved view. */
  onSelectView: (viewId: string) => void;
  /** Callback persisting a changed override. */
  onChangeOverride: (override: DataViewOverride | null) => void;
};

/**
 * Renders a saved view through an override belonging to one place it is shown,
 * so changing the filter, columns, sorting or grouping there leaves the saved
 * view — and every other place showing it — alone. Only what differs from the
 * view is stored, so a later change to the view still reaches this surface.
 *
 * @param options the database, the view read through, and where the override
 * is stored.
 * @returns the view source.
 */
export function useOverriddenViewSource({
  views,
  viewId,
  override,
  onSelectView,
  onChangeOverride,
}: OverriddenSourceOptions): DatabaseViewSource {
  // a surface offering only some of the database's views renders one of
  // those, whatever view id it was left pointing at
  const savedView =
    views.find((item) => item.id === viewId) ?? views[0] ?? undefined;
  const viewsKey = views.map((item) => item.id).join(",");
  // the override arrives as a plain attribute of a prosemirror node, which
  // hands back an equal-but-new object whenever the node is re-created, so
  // the rendered view is memoized by value — its identity decides when rows
  // are queried again
  const overrideKey = JSON.stringify(override ?? null);

  const view = React.useMemo(
    () => (savedView ? applyViewOverride(savedView, override) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedView, overrideKey]
  );

  const updateView = React.useCallback(
    (attrs: Partial<DataView>) => {
      if (!savedView) {
        return;
      }
      onChangeOverride(mergeIntoOverride(savedView, override ?? {}, attrs));
    },
    [savedView, override, onChangeOverride]
  );

  return React.useMemo(
    () => ({
      views,
      view,
      baseFilter: savedView
        ? baseFilterForOverride(savedView, override)
        : undefined,
      selectView: onSelectView,
      updateView,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewsKey, view, savedView, overrideKey, onSelectView, updateView]
  );
}
