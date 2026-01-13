import { z } from 'zod';
import { llmJson } from './langgraph_json.js';
export const complexitySchema = z.object({
    isComplex: z.boolean(),
    reason: z.string().optional(),
});
export async function classifyComplexity(message, deps) {
    const docs = deps.getCommandDocs();
    const persona = (deps.personaPreamble ?? '').trim();
    const systemPrompt = (persona ? `${persona}\n\n` : '') +
        'You are a classifier for a Minecraft NPC agent. Decide if the user objective requires multi-step planning (complex) or can be handled directly (not complex). Return ONLY valid JSON.';
    const userPrompt = `Objective: ${message}\n\nAvailable commands documentation:\n${docs}\n\nReturn JSON: {"isComplex": true|false, "reason": "optional short reason"}.`;
    return llmJson(deps.model, systemPrompt, userPrompt, complexitySchema);
}
