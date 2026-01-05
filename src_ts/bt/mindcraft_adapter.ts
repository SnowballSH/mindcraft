import { executeCommand } from '../../src/agent/commands/index.js';

export interface MindcraftCommandResult {
  ok: boolean;
  output: string;
}

export interface MindcraftAdapter {
  execCommand: (agent: any, commandName: string, args: unknown[]) => Promise<MindcraftCommandResult>;
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return `"${arg.replaceAll('"', '\\"')}"`;
  }
  if (typeof arg === 'number' || typeof arg === 'boolean') {
    return String(arg);
  }
  throw new Error(`Unsupported arg type: ${typeof arg}`);
}

export const defaultMindcraftAdapter: MindcraftAdapter = {
  async execCommand(agent: any, commandName: string, args: unknown[]): Promise<MindcraftCommandResult> {
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
