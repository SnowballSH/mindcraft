import { commandExists, containsCommand, executeCommand, getCommandDocs, isAction, truncCommandMessage, } from '../../../src/agent/commands/index.js';
import convoManager from '../../../src/agent/conversation.js';
import settings from '../../../src/agent/settings.js';
import { handleEnglishTranslation } from '../../../src/utils/translator.js';
export const defaultDeps = {
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
