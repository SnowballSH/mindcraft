import {
  commandExists,
  containsCommand,
  executeCommand,
  getCommandDocs,
  isAction,
  truncCommandMessage,
} from '../../../src/agent/commands/index.js';
import convoManager from '../../../src/agent/conversation.js';
import settings from '../../../src/agent/settings.js';
import { handleEnglishTranslation } from '../../../src/utils/translator.js';

export interface MessageGraphDeps {
  settings: typeof settings;
  convoManager: typeof convoManager;
  handleEnglishTranslation: typeof handleEnglishTranslation;
  commands: {
    containsCommand: typeof containsCommand;
    commandExists: typeof commandExists;
    executeCommand: typeof executeCommand;
    getCommandDocs: typeof getCommandDocs;
    truncCommandMessage: typeof truncCommandMessage;
    isAction: typeof isAction;
  };
}

export const defaultDeps: MessageGraphDeps = {
  settings,
  convoManager,
  handleEnglishTranslation,
  commands: {
    containsCommand,
    commandExists,
    executeCommand,
    getCommandDocs,
    truncCommandMessage,
    isAction,
  },
};


