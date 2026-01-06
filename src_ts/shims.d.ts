declare module '../../src/agent/commands/index.js' {
  export function executeCommand(agent: any, message: string): Promise<any>;
  export function commandExists(commandName: string): boolean;
  export function containsCommand(message: string): string | null;
}

declare module '../../src/agent/npc/item_goal.js' {
  export class ItemGoal {
    constructor(agent: any);
    executeNext(item_name: string, item_quantity?: number): Promise<boolean>;
  }
}

declare module '../../src/agent/library/world.js' {
  export function getInventoryCounts(bot: any): Record<string, number>;
}

declare module '../../src/agent/commands/actions.js' {
  export const actionsList: Array<{
    name: string;
    description?: string;
    params?: Record<
      string,
      {
        type: string;
        description?: string;
        domain?: [number, number] | [number, number, '[)' | '()' | '(]' | '[]'];
      }
    >;
  }>;
}

declare module '../../src/agent/commands/queries.js' {
  export const queryList: Array<{
    name: string;
    description?: string;
    params?: Record<
      string,
      {
        type: string;
        description?: string;
        domain?: [number, number] | [number, number, '[)' | '()' | '(]' | '[]'];
      }
    >;
  }>;
}
