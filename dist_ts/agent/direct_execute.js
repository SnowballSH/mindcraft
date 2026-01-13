import { z } from 'zod';
import { llmJson } from './langgraph_json.js';
export const directExecuteSchema = z.object({
    decision: z.enum(['direct_command', 'respond']),
    command: z.string().optional(),
    response: z.string().optional(),
});
export async function decideDirectExecute(message, deps) {
    const docs = deps.getCommandDocs();
    const persona = (deps.personaPreamble ?? '').trim();
    const systemPrompt = (persona ? `${persona}\n\n` : '') +
        'You are a direct-execution controller for a Minecraft NPC agent. For a NON-COMPLEX user objective, either respond conversationally or produce exactly ONE valid Mindcraft command (starting with !). Return ONLY valid JSON.';
    const userPrompt = `Objective: ${message}\n\nAvailable commands documentation:\n${docs}\n\nReturn JSON:\n- {"decision":"respond","response":"..."} OR\n- {"decision":"direct_command","command":"!someCommand(arg1, \"arg2\")"}`;
    return llmJson(deps.model, systemPrompt, userPrompt, directExecuteSchema);
}
