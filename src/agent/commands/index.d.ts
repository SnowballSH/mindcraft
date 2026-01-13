export function executeCommand(agent: any, message: string): Promise<any>;
export function commandExists(commandName: string): boolean;
export function containsCommand(message: string): string | null;
export function getCommandDocs(agent: any): string;
export function truncCommandMessage(message: string): string;
export function isAction(commandName: string): boolean;


