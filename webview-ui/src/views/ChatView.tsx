import { v4 as uuidv4 } from 'uuid';
import React, { useEffect, useRef, useState } from 'react';

import { MessageType, Role } from '../../../shared/model';
import { EventMessage, EventPayloads, EventType, newEventRequest } from '../../../shared/protocol';
import { VSCodeWrapper } from '../api/vscodeApi';
import {
  addMessages,
  clearMessages,
  setInitState,
  setIsMessageProcessing,
  setIsProjectSyncing
} from '../core/chat/chatSlice';
import { useAppDispatch, useAppSelector } from '../core/store';
import { ChatInputBox } from '../components/chat/ChatInputBox';
import { ChatMessageList } from '../components/chat/ChatMessageList';
import { ProjectSyncProgress } from '../components/chat/ProjectSyncProgress';
import { FigmaFilePickerModal } from '../components/figma/FigmaFilePickerModal';
import { ChatMessage } from '../core/message/ChatMessage.model';

const ChatView: React.FunctionComponent<{
  vscodeAPI: Pick<VSCodeWrapper, 'postMessage' | 'onMessage'>;
}> = ({ vscodeAPI }) => {
  const dispatch = useAppDispatch();

  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const initState = useAppSelector((state) => state.chat.init);
  const isProjectSyncing = useAppSelector((state) => state.chat.isProjectSyncing);
  const isMessageProcessing = useAppSelector((state) => state.chat.isMessageProcessing);

  const [projectSyncProgress, setProjectSyncProgress] = useState(0);
  const [openFigmaFilePickerModal, setOpenFigmaFilePickerModal] = useState(false);

  useEffect(() => {
    const unsubscribe = vscodeAPI.onMessage((message: EventMessage<EventType>) => {
      const { command, payload, error } = message;

      switch (command) {
        case EventType.INITIALIZED: {
          const initState = payload as EventPayloads[typeof command]['response'];
          dispatch(setInitState(initState));
          break;
        }
        case EventType.SYNC_PROJECT_PROGRESS: {
          const { progress } = payload as EventPayloads[typeof command]['response'];

          if (progress === 0) {
            dispatch(setIsProjectSyncing(true));
            setProjectSyncProgress(0);
          }
          if (progress === 100) {
            dispatch(setIsProjectSyncing(false));
          }

          setProjectSyncProgress((prev) => (prev < progress ? progress : prev));
          break;
        }
        case EventType.FIGMA_OAUTH_CONNECT: {
          const isFigmaAuthenticated = payload as EventPayloads[typeof command]['response'];
          dispatch(setInitState({ isFigmaAuthenticated }));
          break;
        }
        case EventType.FIGMA_OAUTH_DISCONNECT: {
          dispatch(setInitState({ isFigmaAuthenticated: false }));
          break;
        }
        case EventType.NEW_MESSAGE: {
          dispatch(setIsMessageProcessing(false));

          if (error) {
            console.error(`Error processing 'new_message': ${message.error}`);
            return;
          }

          const newMessage = payload as EventPayloads[typeof command]['response'];
          if (!newMessage) {
            return;
          }

          dispatch(addMessages([newMessage]));
          break;
        }
        case EventType.ADD_MESSAGE: {
          const newMessage = payload as EventPayloads[typeof command]['response'];
          dispatch(addMessages([newMessage]));
          break;
        }
        case EventType.CMD_NEW_THREAD: {
          dispatch(clearMessages());
          vscodeAPI.postMessage(newEventRequest(EventType.NEW_THREAD));
          break;
        }
        case EventType.CMD_SYNC_PROJECT: {
          vscodeAPI.postMessage(newEventRequest(EventType.SYNC_PROJECT));
          break;
        }
      }
    });

    return () => unsubscribe();
  }, [vscodeAPI]);

  // If we are here that means we are authenticated and have active subscription or token
  useEffect(() => {
    // Event "initialized" is used to notify the extension that the webview is ready
    vscodeAPI.postMessage(newEventRequest(EventType.INITIALIZED));

    // Clear the previous interval if it exists
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
    }

    // Sync user project on every 5 minutes
    syncIntervalRef.current = setInterval(
      () => {
        vscodeAPI.postMessage(newEventRequest(EventType.SYNC_PROJECT));
      },
      5 * 60 * 1000
    );

    // Cleanup function to clear the interval when the component unmounts or before the effect runs again
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [vscodeAPI]);

  const handleTextMessageSend = (content: string) => {
    const newMessage: ChatMessage = { id: uuidv4(), role: Role.User, type: MessageType.Text, content };
    dispatch(addMessages([newMessage]));
    vscodeAPI.postMessage(newEventRequest(EventType.NEW_MESSAGE, [newMessage]));
    dispatch(setIsMessageProcessing(true));
  };

  function handleImageUpload(file: File): void {
    dispatch(
      addMessages([
        {
          id: uuidv4(),
          role: Role.User,
          type: MessageType.Image,
          content: URL.createObjectURL(file)
        }
      ])
    );

    vscodeAPI.postMessage(
      newEventRequest(EventType.NEW_MESSAGE, [
        {
          type: MessageType.Image,
          content: (file as any).path
        }
      ])
    );

    dispatch(setIsMessageProcessing(true));
  }

  function handleFigmaButtonClicked(): void {
    if (!initState.isFigmaAuthenticated) {
      vscodeAPI.postMessage(newEventRequest(EventType.FIGMA_OAUTH_CONNECT));
      return;
    }

    setOpenFigmaFilePickerModal(true);
  }

  /**
   *
   * @param figmaSelectionLink Figma selection link. Example: https://www.figma.com/design/GAo9lY4bIk8j2UBUwU33l9/Wireframing-in-Figma?node-id=0-761&t=1QgxKWtCMVPD6cci-4
   */
  async function handleFigmaFileSelected(figmaSelectionLink: string): Promise<boolean> {
    vscodeAPI.postMessage(
      newEventRequest(EventType.NEW_MESSAGE, [
        {
          type: MessageType.Figma,
          content: figmaSelectionLink
        }
      ])
    );

    dispatch(setIsMessageProcessing(true));
    return true;
  }

  const disableIteractions = isMessageProcessing || isProjectSyncing || !initState.isInitialized;

  return (
    <>
      <div className="flex flex-col h-full p-2">
        <ChatMessageList />
        <ProjectSyncProgress progress={projectSyncProgress} />
        <ChatInputBox
          disabled={disableIteractions}
          onFigmaButtonClicked={handleFigmaButtonClicked}
          onFileSelected={handleImageUpload}
          onSendClicked={handleTextMessageSend}
        />
      </div>

      <FigmaFilePickerModal
        open={openFigmaFilePickerModal}
        onClose={() => setOpenFigmaFilePickerModal(false)}
        onSubmit={handleFigmaFileSelected}
      />
    </>
  );
};

export default ChatView;
