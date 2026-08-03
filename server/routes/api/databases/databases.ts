import Router from "koa-router";
import { Op } from "sequelize";
import type { Property } from "@shared/types";
import { PropertyType, TeamPreference } from "@shared/types";
import { errToString } from "@shared/utils/error";
import { validateDataViews } from "@shared/utils/properties";
import { ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import documentCreator, {
  authorizeDocumentCreate,
} from "@server/commands/documentCreator";
import { Database, Document } from "@server/models";
import { RelationHelper } from "@server/models/helpers/RelationHelper";
import { authorize } from "@server/policies";
import { presentDatabase, presentPolicies } from "@server/presenters";
import type { APIContext } from "@server/types";
import * as T from "./schema";

const router = new Router();

/** Rejects the request when document databases are not enabled for the team. */
function authorizeFeature(ctx: APIContext) {
  const { user } = ctx.state.auth;
  if (!user.team.getPreference(TeamPreference.DocumentDatabases)) {
    throw ValidationError("Document databases are currently disabled");
  }
}

router.post(
  "databases.list",
  auth(),
  validate(T.DatabasesListSchema),
  async (ctx: APIContext<T.DatabasesListReq>) => {
    const { collectionId, archived } = ctx.input.body;
    const { user } = ctx.state.auth;
    authorizeFeature(ctx);

    const databases = await Database.findAll({
      where: { teamId: user.teamId },
      order: [["createdAt", "ASC"]],
    });

    // the anchor documents carry location and archived state, and loading
    // them through the membership scope lets the presented policies see the
    // user's access to documents in private collections. A requested
    // collection is intersected with the readable ones rather than trusted.
    const readableCollectionIds = await user.collectionIds();
    const collectionIds = collectionId
      ? readableCollectionIds.filter((id) => id === collectionId)
      : readableCollectionIds;
    const anchors = await Document.withMembershipScope(user.id).findAll({
      where: {
        id: databases.map((database) => database.id),
        collectionId: collectionIds,
        archivedAt: archived ? { [Op.ne]: null } : { [Op.is]: null },
      },
    });
    const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));

    const visible = databases.filter((database) => {
      database.document = anchorById.get(database.id);
      return !!database.document;
    });

    ctx.body = {
      data: visible.map(presentDatabase),
      policies: presentPolicies(user, visible),
    };
  }
);

router.post(
  "databases.info",
  auth(),
  validate(T.DatabasesInfoSchema),
  async (ctx: APIContext<T.DatabasesInfoReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    authorizeFeature(ctx);

    const database = await Database.findByPk(id);
    if (database) {
      database.document = await Document.findByPk(database.id, {
        userId: user.id,
      });
    }
    authorize(user, "read", database);

    ctx.body = {
      data: presentDatabase(database),
      policies: presentPolicies(user, [database]),
    };
  }
);

router.post(
  "databases.create",
  auth(),
  validate(T.DatabasesCreateSchema),
  transaction(),
  async (ctx: APIContext<T.DatabasesCreateReq>) => {
    const { collectionId, parentDocumentId, name, icon, color, dataSchema } =
      ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    authorizeFeature(ctx);

    // a database is created wherever a document can be: at a collection root
    // or nested under another document, inheriting the parent's collection
    const { collection } = await authorizeDocumentCreate(ctx, {
      collectionId,
      parentDocumentId,
    });

    const document = await documentCreator(ctx, {
      title: name || "Untitled database",
      // a database icon by default, so databases are recognizable among
      // ordinary documents in the sidebar and search
      icon: icon ?? "database",
      color: color ?? undefined,
      collectionId: collection?.id,
      parentDocumentId,
      publish: true,
    });

    const schema: Property[] = dataSchema ?? [];
    const database = await Database.create(
      {
        id: document.id,
        dataSchema: schema,
        views: [Database.buildDefaultView(schema)],
        teamId: user.teamId,
        createdById: user.id,
      },
      { transaction }
    );

    await RelationHelper.syncInverseProperties(database, [], { transaction });

    database.document = document;

    ctx.body = {
      data: presentDatabase(database),
      policies: presentPolicies(user, [database]),
    };
  }
);

router.post(
  "databases.update",
  auth(),
  validate(T.DatabasesUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.DatabasesUpdateReq>) => {
    const { id, titleName, dataSchema, views } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    authorizeFeature(ctx);

    const database = await Database.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (database) {
      database.document = await Document.findByPk(database.id, {
        userId: user.id,
        transaction,
      });
    }
    authorize(user, "update", database);

    const previousSchema = database.dataSchema;

    if (titleName !== undefined) {
      database.titleName = titleName?.trim() || null;
    }
    if (dataSchema !== undefined) {
      database.dataSchema = dataSchema as Property[];
    }
    if (views !== undefined) {
      database.views = views;
    }

    // deleting a column replaces the whole schema, and the caller cannot know
    // what else pointed at the property it dropped — so clear those references
    // here rather than rejecting an update the client had no way to get right
    if (dataSchema !== undefined) {
      database.pruneDanglingReferences();
    }

    // views may only reference properties that exist in the schema
    try {
      validateDataViews(database.views, database.dataSchema);
    } catch (error) {
      throw ValidationError(errToString(error));
    }

    await database.save({ transaction });

    if (dataSchema !== undefined) {
      await RelationHelper.syncInverseProperties(database, previousSchema, {
        transaction,
      });

      // enabling auto-numbering numbers the rows that exist already, so the
      // sequence is complete rather than starting with the next created row
      const newlyAutoNumbered = database.dataSchema.filter(
        (property) =>
          property.type === PropertyType.Number &&
          property.config?.autoNumber &&
          !previousSchema?.find((item) => item.id === property.id)?.config
            ?.autoNumber
      );
      await database.assignAutoNumbers(newlyAutoNumbered, { transaction });

      // disabling auto-numbering empties the cells again — the numbers were
      // machine-assigned, and re-enabling renumbers from scratch anyway
      const newlyDisabled = (previousSchema ?? []).filter(
        (property) =>
          property.config?.autoNumber &&
          database.dataSchema.some(
            (item) => item.id === property.id && !item.config?.autoNumber
          )
      );
      await database.clearPropertyValues(
        newlyDisabled.map((property) => property.id),
        { transaction }
      );
    }

    ctx.body = {
      data: presentDatabase(database),
      policies: presentPolicies(user, [database]),
    };
  }
);

router.post(
  "databases.move_row",
  auth(),
  validate(T.DatabasesMoveRowSchema),
  transaction(),
  async (ctx: APIContext<T.DatabasesMoveRowReq>) => {
    const { id, documentId, index, parentDocumentId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    authorizeFeature(ctx);

    const database = await Database.findByPk(id, { transaction });
    if (database) {
      database.document = await Document.findByPk(database.id, {
        userId: user.id,
        transaction,
      });
    }
    // the manual order is a property of the database, not of the row, so it is
    // the database the actor has to be able to update
    authorize(user, "update", database);

    // loaded without the user scope, and without a row lock: the scope's
    // joins put the row on the nullable side of an outer join, which Postgres
    // will not lock, and a single index written by whoever dragged last needs
    // no more serializing than that. Reading the row is authorized by the
    // check below — it has to belong to the database the actor may update.
    const document = await Document.findByPk(documentId, {
      transaction,
      rejectOnEmpty: true,
    });
    if (document.databaseId !== database.id) {
      throw ValidationError("Document is not a row of this database");
    }

    // a move may also reparent the row: under another row of the same
    // database, or back to the top level
    if (parentDocumentId !== undefined) {
      if (parentDocumentId === document.id) {
        throw ValidationError("A row cannot be its own parent");
      }
      if (parentDocumentId) {
        const parent = await Document.findByPk(parentDocumentId, {
          transaction,
          rejectOnEmpty: true,
        });
        if (parent.databaseId !== database.id) {
          throw ValidationError(
            "parentDocumentId must be a row of the same database"
          );
        }

        // walking up from the new parent must never reach the moved row, or
        // the row's subtree would be detached into a cycle
        const seen = new Set<string>([parent.id]);
        let ancestorId = parent.parentDocumentId;
        while (ancestorId) {
          if (ancestorId === document.id) {
            throw ValidationError(
              "A row cannot be nested under its own sub-item"
            );
          }
          if (seen.has(ancestorId)) {
            break;
          }
          seen.add(ancestorId);
          const ancestor = await Document.findByPk(ancestorId, {
            transaction,
          });
          ancestorId = ancestor?.parentDocumentId ?? null;
        }
      }
      document.parentDocumentId = parentDocumentId;
    }

    document.databaseIndex = index;
    await document.save({ transaction, silent: true, hooks: false });

    ctx.body = {
      success: true,
    };
  }
);

export default router;
