import { TeamPreference } from "@shared/types";
import { Database, User } from "@server/models";
import { allow, can } from "./cancan";
import { and, isTeamModel, isTeamMutable } from "./utils";

/**
 * Databases inherit their authorization from their anchor document — the
 * document sharing the database's id. Reading a database means being able to
 * read that document, and changing its schema, views or rows means being able
 * to update it. Every ability additionally requires the feature to be enabled
 * for the team. Routes must load the anchor document through the user scope
 * and assign it to `database.document` before authorizing.
 */

allow(User, "read", Database, (actor, database) =>
  and(
    isTeamModel(actor, database),
    !!actor.team?.getPreference(TeamPreference.DocumentDatabases),
    can(actor, "read", database?.document)
  )
);

allow(User, ["update", "createRow"], Database, (actor, database) =>
  and(
    isTeamModel(actor, database),
    isTeamMutable(actor),
    !actor.isGuest,
    !actor.isViewer,
    !!actor.team?.getPreference(TeamPreference.DocumentDatabases),
    can(actor, "update", database?.document)
  )
);
