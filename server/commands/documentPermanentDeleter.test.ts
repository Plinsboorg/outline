import { randomUUID } from "node:crypto";
import { subDays } from "date-fns";
import type { Property } from "@shared/types";
import { PropertyType } from "@shared/types";
import { errToString } from "@shared/utils/error";
import { Attachment, Document, Event } from "@server/models";
import { RelationHelper } from "@server/models/helpers/RelationHelper";
import {
  buildAttachment,
  buildDatabase,
  buildDocument,
  buildDraftDocument,
} from "@server/test/factories";
import { mockTaskSchedule } from "@server/test/support";
import documentPermanentDeleter from "./documentPermanentDeleter";

const schedule = mockTaskSchedule();

describe("documentPermanentDeleter", () => {
  it("should destroy documents", async () => {
    const document = await buildDocument({
      publishedAt: subDays(new Date(), 90),
      deletedAt: new Date(),
    });
    const countDeletedDoc = await documentPermanentDeleter([document]);
    expect(countDeletedDoc).toEqual(1);
    expect(
      await Document.unscoped().count({
        where: {
          teamId: document.teamId,
        },
        paranoid: false,
      })
    ).toEqual(0);
  });

  it("should error when trying to destroy undeleted documents", async () => {
    const document = await buildDocument({
      publishedAt: new Date(),
    });
    let error;

    try {
      await documentPermanentDeleter([document]);
    } catch (err) {
      error = errToString(err);
    }

    expect(error).toEqual(
      `Cannot permanently delete ${document.id} document. Please delete it and try again.`
    );
  });

  it("should destroy attachments no longer referenced", async () => {
    const document = await buildDocument({
      publishedAt: subDays(new Date(), 90),
      deletedAt: new Date(),
    });
    const attachment = await buildAttachment({
      teamId: document.teamId,
      documentId: document.id,
    });
    await buildAttachment({
      teamId: document.teamId,
      documentId: document.id,
    });
    document.text = `![text](${attachment.redirectUrl})`;
    await document.save();
    const countDeletedDoc = await documentPermanentDeleter([document]);
    expect(countDeletedDoc).toEqual(1);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(
      await Document.unscoped().count({
        where: {
          teamId: document.teamId,
        },
        paranoid: false,
      })
    ).toEqual(0);
  });

  it("should handle unknown attachment ids", async () => {
    const document = await buildDocument({
      publishedAt: subDays(new Date(), 90),
      deletedAt: new Date(),
    });
    const attachment = await buildAttachment({
      teamId: document.teamId,
      documentId: document.id,
    });
    document.text = `![text](${attachment.redirectUrl})`;
    await document.save();
    // remove attachment so it no longer exists in the database, this is also
    // representative of a corrupt attachment id in the doc or the regex returning
    // an incorrect string
    await attachment.destroy({
      force: true,
    });
    const countDeletedDoc = await documentPermanentDeleter([document]);
    expect(countDeletedDoc).toEqual(1);
    expect(
      await Attachment.count({
        where: {
          teamId: document.teamId,
        },
      })
    ).toEqual(0);
    expect(
      await Document.unscoped().count({
        where: {
          teamId: document.teamId,
        },
        paranoid: false,
      })
    ).toEqual(0);
  });

  it("should not destroy a document restored between query and destroy", async () => {
    const document = await buildDocument({
      publishedAt: subDays(new Date(), 90),
      deletedAt: subDays(new Date(), 60),
    });

    // Simulate the race: caller queried this document while it was soft-deleted,
    // but the user restored it before documentPermanentDeleter runs the destroy.
    await Document.unscoped().update(
      { deletedAt: null },
      { where: { id: document.id }, paranoid: false }
    );

    // The stale in-memory object still has deletedAt set (as it would in the
    // real cleanup task flow), but the DB row is now active.
    const countDeletedDoc = await documentPermanentDeleter([document]);
    expect(countDeletedDoc).toEqual(0);

    // Document must survive — it was restored.
    expect(
      await Document.unscoped().count({
        where: { id: document.id },
        paranoid: false,
      })
    ).toEqual(1);
  });

  it("should not detach children of a document restored between query and destroy", async () => {
    const parent = await buildDocument({
      publishedAt: subDays(new Date(), 90),
      deletedAt: subDays(new Date(), 60),
    });
    const child = await buildDocument({
      teamId: parent.teamId,
      parentDocumentId: parent.id,
    });

    await Document.unscoped().update(
      { deletedAt: null },
      { where: { id: parent.id }, paranoid: false }
    );

    await documentPermanentDeleter([parent]);

    await child.reload();
    expect(child.parentDocumentId).toEqual(parent.id);
  });

  it("should detach draft children rather than cascade delete them", async () => {
    const parent = await buildDocument({
      publishedAt: subDays(new Date(), 90),
      deletedAt: subDays(new Date(), 60),
    });
    const child = await buildDraftDocument({
      teamId: parent.teamId,
      parentDocumentId: parent.id,
    });

    const countDeletedDoc = await documentPermanentDeleter([parent]);
    expect(countDeletedDoc).toEqual(1);

    const reloaded = await Document.unscoped().findByPk(child.id);
    expect(reloaded?.parentDocumentId).toEqual(null);
  });

  it("should not destroy attachments referenced in other documents", async () => {
    const document1 = await buildDocument();
    const document = await buildDocument({
      teamId: document1.teamId,
      publishedAt: subDays(new Date(), 90),
      deletedAt: subDays(new Date(), 60),
    });
    const attachment = await buildAttachment({
      teamId: document1.teamId,
      documentId: document.id,
    });
    document1.text = `![text](${attachment.redirectUrl})`;
    await document1.save();
    document.text = `![text](${attachment.redirectUrl})`;
    await document.save();
    expect(
      await Attachment.count({
        where: {
          teamId: document.teamId,
        },
      })
    ).toEqual(1);
    const countDeletedDoc = await documentPermanentDeleter([document]);
    expect(countDeletedDoc).toEqual(1);
    expect(
      await Attachment.count({
        where: {
          teamId: document.teamId,
        },
      })
    ).toEqual(1);
    expect(
      await Document.unscoped().count({
        where: {
          teamId: document.teamId,
        },
        paranoid: false,
      })
    ).toEqual(1);
  });

  it("should clear a deleted row's back-references from the other side of a bidirectional relation", async () => {
    const projects = await buildDatabase();
    const tasks = await buildDatabase({ teamId: projects.teamId });

    const relationId = randomUUID();
    const inverseId = randomUUID();
    const schema: Property[] = [
      {
        id: relationId,
        name: "Tasks",
        type: PropertyType.Relation,
        config: { targetDatabaseId: tasks.id, inversePropertyId: inverseId },
      },
    ];
    projects.dataSchema = schema;
    await projects.save();
    await RelationHelper.syncInverseProperties(projects, []);
    await tasks.reload();

    const project = await buildDocument({
      teamId: projects.teamId,
      collectionId: projects.document!.collectionId,
      databaseId: projects.id,
      publishedAt: subDays(new Date(), 90),
    });
    const task = await buildDocument({
      teamId: projects.teamId,
      collectionId: tasks.document!.collectionId,
      databaseId: tasks.id,
    });

    project.properties = { [relationId]: [task.id] };
    await project.save();
    await RelationHelper.syncInverseValues(project, projects.dataSchema, {});
    await task.reload();
    expect(task.properties[inverseId]).toEqual([project.id]);

    await project.destroy();
    await documentPermanentDeleter([project]);

    await task.reload();
    expect(task.properties[inverseId]).toBeUndefined();
  });

  it("should tell clients a deleted database is gone, and its relation partner to reload", async () => {
    const projects = await buildDatabase();
    const tasks = await buildDatabase({ teamId: projects.teamId });

    projects.dataSchema = [
      {
        id: randomUUID(),
        name: "Tasks",
        type: PropertyType.Relation,
        config: {
          targetDatabaseId: tasks.id,
          inversePropertyId: randomUUID(),
        },
      },
    ];
    await projects.save();
    await RelationHelper.syncInverseProperties(projects, []);

    const anchor = await Document.findByPk(projects.id, {
      rejectOnEmpty: true,
    });
    const scheduled = vi.spyOn(Event, "schedule");

    try {
      await anchor.destroy();
      await documentPermanentDeleter([anchor]);

      const broadcast = scheduled.mock.calls.map(([event]) => event);
      expect(
        broadcast.find(
          (event) =>
            event?.name === "databases.delete" && event.modelId === projects.id
        )
      ).toBeDefined();
      expect(
        broadcast.find(
          (event) =>
            event?.name === "databases.update" && event.modelId === tasks.id
        )
      ).toBeDefined();
    } finally {
      scheduled.mockRestore();
    }
  });
});
