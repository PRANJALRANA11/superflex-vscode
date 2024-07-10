import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { AssistantCreateParams } from "openai/src/resources/beta/assistants.js";

import { ElementAICache } from "../cache/ElementAICache";
import { ASSISTANT_DESCRIPTION, ASSISTANT_INSTRUCTIONS, ASSISTANT_NAME } from "./constants";
import { AIProvider, Assistant, Message, MessageContent, TextDelta, VectorStore } from "./AIProvider";

const FILE_ID_MAP_NAME = "open-ai-file-id-map.json";

class OpenAIVectorStore implements VectorStore {
  id: string;

  private _openai: OpenAI;

  constructor(id: string, openai: OpenAI) {
    this.id = id;
    this._openai = openai;
  }

  async syncFiles(filePaths: string[], progressCb?: (current: number) => void): Promise<void> {
    if (!ElementAICache.storagePath) {
      throw new Error("Storage path is not set");
    }

    if (progressCb) {
      progressCb(0);
    }

    const storagePath = ElementAICache.storagePath;
    const cachedFilePathToIDMap = ElementAICache.get(FILE_ID_MAP_NAME);
    const filePathToIDMap: any = cachedFilePathToIDMap ? JSON.parse(cachedFilePathToIDMap) : {};

    const documentPaths = ElementAICache.cacheFilesSync(filePaths, { ext: ".txt" });
    const progressCoefficient = 98 / documentPaths.length;
    for (let i = 0; i < documentPaths.length; i++) {
      if (progressCb) {
        progressCb(Math.round(i * progressCoefficient));
      }

      const documentPath = documentPaths[i];
      const fileStat = fs.statSync(documentPath.originalPath);

      const relativeFilepath = documentPath.cachedPath.replace(storagePath, "");
      const cachedFile = filePathToIDMap[relativeFilepath];

      // Skip uploading the file if it has not been modified since the last upload
      if (cachedFile && new Date(fileStat.mtime).getTime() <= new Date(cachedFile.createdAt).getTime()) {
        continue;
      }

      try {
        if (cachedFile) {
          await this._openai.files.del(cachedFile.fileID);
        }

        const file = await this._openai.files.create({
          file: fs.createReadStream(documentPath.cachedPath),
          purpose: "assistants",
        });

        await this._openai.beta.vectorStores.files.createAndPoll(this.id, { file_id: file.id });

        filePathToIDMap[relativeFilepath] = { fileID: file.id, createdAt: fileStat.mtime };
      } catch (err: any) {
        console.error(`Failed to upload file ${documentPath}: ${err?.message}`);
      }
    }

    if (progressCb) {
      progressCb(99);
    }

    // Remove the files that are uploaded but missing from the filePaths input
    for (const relativeFilepath of filePathToIDMap) {
      const exists = documentPaths.find(
        (documentPath) => documentPath.cachedPath.replace(storagePath, "") === relativeFilepath
      );
      if (exists) {
        continue;
      }

      try {
        await this._openai.files.del(filePathToIDMap[relativeFilepath].fileID);
        delete filePathToIDMap[relativeFilepath];
      } catch (err: any) {
        console.error(`Failed to delete file ${relativeFilepath}: ${err?.message}`);
      }
    }

    ElementAICache.set(FILE_ID_MAP_NAME, JSON.stringify(filePathToIDMap));
    ElementAICache.removeCachedFilesSync();

    if (progressCb) {
      progressCb(100);
    }
  }
}

class OpenAIAssistant implements Assistant {
  id: string;

  private _openai: OpenAI;

  constructor(id: string, openai: OpenAI) {
    this.id = id;
    this._openai = openai;
  }

  async sendMessage(message: MessageContent, streamResponse?: (event: TextDelta) => Promise<void>): Promise<Message> {
    throw new Error("Method not implemented.");
  }
}

export default class OpenAIProvider implements AIProvider {
  private _openai: OpenAI;

  constructor(openai: OpenAI) {
    this._openai = openai;
  }

  async retrieveVectorStore(id: string): Promise<VectorStore> {
    const vectorStore = await this._openai.beta.vectorStores.retrieve(id);

    return new OpenAIVectorStore(vectorStore.id, this._openai);
  }

  async createVectorStore(name: string): Promise<VectorStore> {
    const vectorStore = await this._openai.beta.vectorStores.create({
      name: `${name}-vector-store`,
      expires_after: {
        anchor: "last_active_at",
        days: 7,
      },
    });

    return new OpenAIVectorStore(vectorStore.id, this._openai);
  }

  async retrieveAssistant(id: string): Promise<Assistant> {
    const assistant = await this._openai.beta.assistants.retrieve(id);

    return new OpenAIAssistant(assistant.id, this._openai);
  }

  async createAssistant(vectorStore?: VectorStore): Promise<Assistant> {
    const createParams: AssistantCreateParams = {
      name: ASSISTANT_NAME,
      description: ASSISTANT_DESCRIPTION,
      instructions: ASSISTANT_INSTRUCTIONS,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
      temperature: 0.2,
    };

    if (vectorStore) {
      createParams.tool_resources = {
        file_search: {
          vector_store_ids: [vectorStore.id],
        },
      };
    }

    const assistant = await this._openai.beta.assistants.create(createParams);

    return new OpenAIAssistant(assistant.id, this._openai);
  }
}
