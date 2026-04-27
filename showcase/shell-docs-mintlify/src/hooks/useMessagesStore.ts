import type { UIMessage } from '@ai-sdk/react';
import { create } from 'zustand';

interface MessagesState {
  messages: UIMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  threadId: string | undefined;
  threadKey: string | undefined;
  setThreadId: (threadId: string | undefined) => void;
  setThreadKey: (key: string | undefined) => void;
}

const useMessagesStore = create<MessagesState>((set) => ({
  status: 'ready',
  messages: [],
  threadId: undefined,
  threadKey: undefined,
  setThreadId: (threadId) => set({ threadId }),
  setThreadKey: (threadKey) => set({ threadKey }),
}));

export default useMessagesStore;
