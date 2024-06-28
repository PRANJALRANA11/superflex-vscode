require("dotenv").config();

import OpenAI from "openai";
import * as vscode from "vscode";

import { Logger } from "./utils/logger";
import { decodeUriAndRemoveFilePrefix } from "./utils";
import { findFiles } from "./scanner";
import { ChatAPI } from "./chat/ChatApi";
import ChatViewProvider from "./chat/ChatViewProvider";
import registerChatWidgetWebview from "./chat/chatWidgetWebview";
import { SUPPORTED_FILE_EXTENSIONS } from "./utils/consts";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  Logger.init(context);

  const openai = new OpenAI();

  void scanWorkspaces(context, openai);

  // Do not await on this function as we do not want VSCode to wait for it to finish
  // before considering ElementAI ready to operate.
  void backgroundInit(context, openai);

  return Promise.resolve();
}

async function scanWorkspaces(
  context: vscode.ExtensionContext,
  openai: OpenAI
) {
  Logger.info(`Scanning workspace folders for files`);

  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  for (const workspaceFolder of workspaceFolders) {
    // TODO(boris): Remove this once we are out of testing
    // Currently here to not abuse the cost of API
    if (workspaceFolder.name !== "sprout-dashboard") {
      continue;
    }

    // Check do we aleady have created a workspace OpenAI Vector Store
    const settingsUri = vscode.Uri.joinPath(
      workspaceFolder.uri,
      ".elementai",
      "settings.json"
    );
    try {
      const settingsBuffer = await vscode.workspace.fs.readFile(settingsUri);
      const settings = JSON.parse(settingsBuffer.toString());
      if (settings.vectorStoreIds[workspaceFolder.name]) {
        return;
      }
    } catch (err) {}

    // Find all files in the workspace folder and put them in OpenAI Vector Store
    try {
      const workspaceFolderPath = decodeUriAndRemoveFilePrefix(
        workspaceFolder.uri.toString()
      );

      const documentsUri: string[] = await findFiles(
        workspaceFolderPath,
        SUPPORTED_FILE_EXTENSIONS.map((ext) => `**/*${ext}`),
        ["**/node_modules/**", "**/build/**", "**/out/**", "**/dist/**"]
      );

      const vectorStore = await openai.beta.vectorStores.create({
        name: `${workspaceFolder.name} Vector Store`,
      });

      // Upload files to the vector store in batches of 500
      const batchSize = 500;
      for (let i = 0; i < documentsUri.length; i += batchSize) {
        Logger.info(`Scanning files: ${batchSize * i}/${documentsUri.length}`);

        await openai.beta.vectorStores.fileBatches.createAndPoll(
          vectorStore.id,
          {
            file_ids: documentsUri.slice(i, i + batchSize),
          }
        );
      }

      // Write the vector store id to root folder
      // This will be used to identify the vector store for the workspace
      // and to update it when new files are added
      await vscode.workspace.fs.writeFile(
        settingsUri,
        Buffer.from(
          JSON.stringify({
            vectorStoreIds: {
              [workspaceFolder.name]: vectorStore.id,
            },
          })
        )
      );
    } catch (err) {
      Logger.error(err);
    }
  }
}

async function backgroundInit(
  context: vscode.ExtensionContext,
  openai: OpenAI
) {
  registerChatWidgetWebview(
    context,
    new ChatViewProvider(context, new ChatAPI(context, { openai: openai }))
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
