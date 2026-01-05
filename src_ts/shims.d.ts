declare module '../../src/agent/commands/index.js' {
  export function executeCommand(agent: any, message: string): Promise<any>;
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
