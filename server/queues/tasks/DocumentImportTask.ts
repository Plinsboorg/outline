import { errToString } from "@shared/utils/error";
import type { SourceMetadata } from "@shared/types";
import { TeamPreference } from "@shared/types";
import documentCreator from "@server/commands/documentCreator";
import documentImporter from "@server/commands/documentImporter";
import { createContext } from "@server/context";
import { Collection, User } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import FileStorage from "@server/storage/files";
import { sequelize } from "@server/storage/database";
import { BaseTask, TaskPriority } from "./base/BaseTask";

type Props = {
  userId: string;
  sourceMetadata: Pick<Required<SourceMetadata>, "fileName" | "mimeType">;
  publish?: boolean;
  collectionId?: string | null;
  parentDocumentId?: string | null;
  ip: string;
  key: string;
};

export type DocumentImportTaskResponse =
  | {
      documentId: string;
    }
  | {
      error: string;
    };

export default class DocumentImportTask extends BaseTask<Props> {
  public async perform({
    key,
    sourceMetadata,
    ip,
    publish,
    collectionId,
    parentDocumentId,
    userId,
  }: Props): Promise<DocumentImportTaskResponse> {
    try {
      const content = await FileStorage.getFileBuffer(key);
      const user = await User.findByPk(userId, {
        rejectOnEmpty: true,
      });

      // Run document conversion and image downloading outside a transaction
      const ctx = createContext({ user, ip });

      // When importing into a database collection, extract frontmatter into
      // typed properties instead of converting it to a YAML codeblock.
      const collection = collectionId
        ? await Collection.findByPk(collectionId)
        : null;
      const team = user.team ?? (await user.$get("team"));
      const extractFrontmatter =
        !!collection?.dataSchema &&
        !!team?.getPreference(TeamPreference.DocumentDatabases);

      const { text, state, title, icon, frontmatter } = await documentImporter({
        user,
        fileName: sourceMetadata.fileName,
        mimeType: sourceMetadata.mimeType,
        content,
        ctx,
        extractFrontmatter,
      });

      const properties =
        frontmatter && collection?.dataSchema
          ? DocumentHelper.frontmatterToProperties(
              frontmatter,
              collection.dataSchema
            )
          : undefined;

      const document = await sequelize.transaction(async (transaction) =>
        documentCreator(
          createContext({
            user,
            ip,
            transaction,
          }),
          {
            sourceMetadata,
            title,
            icon,
            text,
            state,
            publish,
            collectionId,
            parentDocumentId,
            properties,
          }
        )
      );
      return { documentId: document.id };
    } catch (err) {
      return { error: errToString(err) };
    } finally {
      await FileStorage.deleteFile(key);
    }
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Normal,
    };
  }
}
