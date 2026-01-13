import type { ChatModelLike } from './langgraph_json.js';

export interface AgentHistory {
  add: (role: string, content: string) => Promise<void> | void;
  save: () => void;
  getHistory: () => unknown;
}

export interface AgentPrompter {
  chat_model: ChatModelLike;
  promptConvo: (history: unknown) => Promise<string>;
}

export interface AgentSelfPrompter {
  shouldInterrupt: (selfPrompt: boolean) => boolean;
  isActive: () => boolean;
  handleUserPromptedCmd: (selfPrompt: boolean, isAction: boolean) => void;
}

export interface AgentBotLike {
  modes?: { flushBehaviorLog: () => string };
}

export interface AgentAdapter {
  name: string;
  shut_up?: boolean;
  last_sender?: string | null;
  history: AgentHistory;
  prompter: AgentPrompter;
  self_prompter: AgentSelfPrompter;
  bot: AgentBotLike;
  checkTaskDone: () => Promise<void>;
  routeResponse: (toPlayer: string, message: string) => Promise<void> | void;
}


