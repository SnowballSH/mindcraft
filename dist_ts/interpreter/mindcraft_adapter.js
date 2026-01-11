/*
This file defines a small adapter layer between
    TypeScript Behavior Tree runtime and Mindcraft’s existing
    JS command system (executeCommand(...) in src/agent/commands/index.js).

Conceptually:

BT actions want to call something like:
    execCommand(agent, "!givePlayer", ["Steve", "torch", 16])
Mindcraft’s command system expects a single chat-like command string, e.g.:
    !givePlayer("Steve", "torch", 16)
This adapter is responsible for:

1. Formatting structured args into a command string
2. Calling Mindcraft’s real executor
3. Normalizing Mindcraft’s return into a consistent { ok, output } shape
*/
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { executeCommand } = require('../../src/agent/commands/index.js');
function formatArg(arg) {
    if (typeof arg === 'string') {
        return `"${arg.replaceAll('"', '\\"')}"`;
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') {
        return String(arg);
    }
    throw new Error(`Unsupported arg type: ${typeof arg}`);
}
export const defaultMindcraftAdapter = {
    async execCommand(agent, commandName, args) {
        const name = commandName.startsWith('!') ? commandName : `!${commandName}`;
        const argStr = args.length > 0 ? `(${args.map(formatArg).join(', ')})` : '';
        const message = `${name}${argStr}`;
        const result = await executeCommand(agent, message);
        if (typeof result === 'string') {
            // Mindcraft commands return strings for success or error. We can't perfectly distinguish.
            // Convention: treat strings starting with "Error" or "Invalid" as failure.
            const lowered = result.toLowerCase();
            const ok = !(lowered.startsWith('error') || lowered.startsWith('invalid'));
            return { ok, output: result };
        }
        return { ok: true, output: String(result ?? '') };
    },
};
