import { z } from 'zod';
import { llmJson, type ChatModelLike } from './langgraph_json.js';

export const complexitySchema = z.object({
  isComplex: z.boolean(),
  reason: z.string().optional(),
});

export type ComplexityResult = z.infer<typeof complexitySchema>;

export interface ComplexityClassifierDeps {
  model: ChatModelLike;
  getCommandDocs: () => string;
  /**
   * Optional persona/policy preamble to inject into the system prompt.
   * Intended to carry the profile prompt (e.g. profile.conversing) with $NAME substituted.
   * Keep this short and avoid dynamic placeholders like $STATS/$INVENTORY.
   */
  personaPreamble?: string;
}

export async function classifyComplexity(
  message: string,
  deps: ComplexityClassifierDeps,
): Promise<ComplexityResult> {
  const docs = deps.getCommandDocs();
  const persona = (deps.personaPreamble ?? '').trim();
  const systemPrompt =
    (persona ? `${persona}\n\n` : '') +
    'You are a classifier for a Minecraft NPC agent. Decide if the user objective requires multi-step planning (complex) or can be handled directly (not complex). Return ONLY valid JSON.';

  const userPrompt = `Objective: ${message}\n\nAvailable commands documentation:\n${docs}\n\nReturn JSON: {"isComplex": true|false, "reason": "optional short reason"}.`;

  return llmJson(deps.model, systemPrompt, userPrompt, complexitySchema);
}


