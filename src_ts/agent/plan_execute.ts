import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { llmJsonSafe, type ChatModelLike } from './langgraph_json.js';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { tool } from '@langchain/core/tools';
import { ChatMessage } from '@langchain/core/messages';
import type { IRTree, IRNode } from '../interpreter/types.js';
import { parseBehaviorTreeXml } from '../interpreter/xml_parser.js';
import { createDefaultRegistry } from '../interpreter/actions_builtin.js';
import { registerDefaultConditions } from '../interpreter/conditions_builtin.js';
import { createMindcraftCapabilities } from '../interpreter/mindcraft_capabilities.js';
import type { RuntimeContext } from '../interpreter/registry.js';
import type { ActionResult } from '../interpreter/types.js';
import { createInitialState } from '../interpreter/state_init.js';
import { tick } from '../interpreter/interpreter.js';

export interface PlanExecuteAgentLike {
  routeResponse: (toPlayer: string, message: string) => Promise<void> | void;
}

export interface PlanExecuteDeps {
  // NOTE: We still accept `model` for legacy callers, but plan_execute now requires `lcModel`
  // for structured output + tool calling. If `lcModel` is missing, we refuse to run.
  model?: ChatModelLike;
  // REQUIRED LangChain chat model (e.g. ChatOpenAI / ChatGoogleGenerativeAI).
  // Must support withStructuredOutput(), and bindTools() for replanning.
  lcModel: any;
  /**
   * Optional persona/policy preamble to inject into system prompts.
   * Intended to carry the profile prompt (e.g. profile.conversing) with $NAME substituted.
   * Keep this short and avoid dynamic placeholders like $STATS/$INVENTORY.
   */
  personaPreamble?: string;
  getCommandDocs: () => string;
  containsCommand: (message: string) => string | null;
  commandExists: (commandName: string) => boolean;
  executeCommand: (agent: unknown, message: string) => Promise<unknown>;
  // Optional BT tuning knobs
  btRecursionLimit?: number;
  btMaxRepairs?: number;
  btMaxNodes?: number;
}

type StepAttempt = {
  step: string;
  status: 'SUCCESS' | 'FAILURE';
  detail: string;
  attempt: number;
  btFormat?: 'ir' | 'xml';
};

const PlanExecuteState = Annotation.Root({
  input: Annotation<string>({
    reducer: (x, y) => (y ?? x ?? '') as string,
  }),
  source: Annotation<string>({
    reducer: (x, y) => (y ?? x ?? '') as string,
  }),
  plan: Annotation<string[]>({
    reducer: (x, y) => (y ?? x ?? []) as string[],
  }),
  pastSteps: Annotation<[string, string][]>({
    reducer: (x, y) => (x ?? []).concat(y ?? []),
  }),
  stepAttempts: Annotation<StepAttempt[]>({
    reducer: (x, y) => (x ?? []).concat(y ?? []),
  }),
  lastBtDebug: Annotation<string>({
    reducer: (x, y) => (y ?? x ?? '') as string,
  }),
  response: Annotation<string>({
    reducer: (x, y) => (y ?? x ?? '') as string,
  }),
});

const planSchema = z.object({
  steps: z.array(z.string()).describe("different steps to follow, should be in sorted order"),
});

const responseSchema = z.object({
  response: z.string().describe('Response to user.'),
});

const replanSchema = z.object({
  action: z.enum(['plan', 'response']),
  steps: z.array(z.string()).optional(),
  response: z.string().optional(),
});

const stepToCommandSchema = z.object({
  command: z.string().describe('A single Mindcraft command string starting with !'),
});

const BT_NODE_TYPES = ['Sequence', 'Fallback', 'Action', 'Condition'] as const;

// IMPORTANT: Gemini `response_schema` is a restricted schema format and rejects JSON Schema features
// like $ref / anyOf / const which Zod unions/literals often produce.
//
// So we intentionally define a "flat" node schema with optional fields (no unions),
// and enforce type-specific requirements in validateBtSpec().
const kvParamsSchema = z.array(z.object({ key: z.string(), value: z.string() }));
const irNodeSpecSchema = z.object({
  id: z.string(),
  type: z.enum(BT_NODE_TYPES),
  name: z.string().optional(),
  children: z.array(z.string()).optional(),
  params: kvParamsSchema.optional(),
});

// IMPORTANT: Avoid z.record() here.
// Gemini structured output (response_schema) rejects OBJECT types with empty `properties`,
// which is how `z.record` is represented in JSON Schema (additionalProperties only).
// So we use an array form for structured output and convert to the map form internally.
const irTreeArraySchema = z.object({
  rootId: z.string(),
  nodes: z.array(irNodeSpecSchema),
});

const kvVarsSchema = z.array(z.object({ key: z.string(), value: z.string() }));

const btSpecSchema = z
  .object({
    format: z.enum(['ir', 'xml']),
    tree: irTreeArraySchema.optional(),
    xml: z.string().optional(),
    // Same rationale as above: avoid z.record() for Gemini response_schema.
    vars: kvVarsSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.format === 'ir') {
      if (!v.tree) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Missing 'tree' for format 'ir'" });
      if (v.xml) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Do not include 'xml' when format is 'ir'" });
    }
    if (v.format === 'xml') {
      if (!v.xml) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Missing 'xml' for format 'xml'" });
      if (v.tree) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Do not include 'tree' when format is 'xml'" });
    }
  });

function formatPlan(steps: string[]) {
  if (!steps || steps.length === 0) return '';
  return steps.map((s, i) => `${i + 1}) ${s}`).join('  ');
}

export function buildPlanExecuteGraph(
  agent: PlanExecuteAgentLike,
  deps: PlanExecuteDeps,
  { onPlan, onStep, onReplan }: { onPlan?: (steps: string[]) => Promise<void> | void; onStep?: (step: string, result: string) => Promise<void> | void; onReplan?: (steps: string[]) => Promise<void> | void } = {},
) {
  const personaPreamble = String(deps.personaPreamble ?? '').trim();
  const personaBlock = personaPreamble ? `${personaPreamble}\n\n` : '';

  function requireLcModel(feature: string): any {
    const m = deps.lcModel;
    if (!m) {
      throw new Error(
        `plan_execute requires deps.lcModel for ${feature}. ` +
          `Your current provider integration did not construct a LangChain model, so structured output cannot be enforced.`,
      );
    }
    return m;
  }

  function trunc(v: unknown, max = 800): string {
    const s = String(v ?? '');
    if (s.length <= max) return s;
    return `${s.slice(0, Math.floor(max * 0.6))}...${s.slice(-Math.floor(max * 0.4))}`;
  }

  function nodeLog(node: string, extra?: Record<string, unknown>) {
    // Always log plan/execute nodes for now (dev-focused); keep compact.
    console.log('[LangGraph][PlanExecute]', node, extra ?? {});
  }

  function validateBtSpec(
    spec: z.infer<typeof btSpecSchema>,
    {
      allowedActions,
      allowedConditions,
      maxNodes,
    }: { allowedActions: Set<string>; allowedConditions: Set<string>; maxNodes: number },
  ): { ok: true; tree: IRTree; vars: Record<string, string>; btFormat: 'ir' | 'xml' } | { ok: false; error: string } {
    try {
      const vars: Record<string, string> = {};
      for (const kv of spec.vars ?? []) {
        const k = String((kv as any)?.key ?? '').trim();
        if (!k) continue;
        vars[k] = String((kv as any)?.value ?? '');
      }

      const tree: IRTree =
        spec.format === 'ir'
          ? (() => {
              const t = spec.tree as any;
              const rootId = String(t?.rootId ?? '');
              const nodesArr = Array.isArray(t?.nodes) ? (t.nodes as any[]) : [];
              const nodes: Record<string, IRNode> = {};
              for (const n of nodesArr) {
                const id = String(n?.id ?? '');
                if (!id) throw new Error('IRTree.nodes entry missing id');
                if (nodes[id]) throw new Error(`Duplicate node id '${id}'`);
                const type = String(n?.type ?? '');
                const name = n?.name !== undefined ? String(n.name) : undefined;
                const children = Array.isArray(n?.children) ? n.children.map((c: any) => String(c)) : undefined;
                const paramsArr = Array.isArray(n?.params) ? n.params : [];
                const params: Record<string, unknown> = {};
                for (const kvp of paramsArr) {
                  const k = String(kvp?.key ?? '').trim();
                  if (!k) continue;
                  params[k] = String(kvp?.value ?? '');
                }

                // Type-specific constraints (mirrors interpreter expectations)
                if (type === 'Action' || type === 'Condition') {
                  if (!name || name.trim().length === 0) throw new Error(`${type} node '${id}' missing name`);
                }
                if (type === 'Sequence' || type === 'Fallback') {
                  if (!children || children.length === 0) throw new Error(`${type} node '${id}' missing children[]`);
                }

                nodes[id] = {
                  id,
                  type: type as any,
                  ...(name ? { name } : {}),
                  ...(children ? { children } : {}),
                  ...(Object.keys(params).length > 0 ? { params } : {}),
                } as IRNode;
              }
              return { rootId, nodes };
            })()
          : parseBehaviorTreeXml(String(spec.xml ?? ''));

      const nodeIds = Object.keys(tree.nodes ?? {});
      if (!tree.rootId || !tree.nodes || nodeIds.length === 0) {
        return { ok: false, error: 'BT tree is empty or missing root/nodes' };
      }
      if (!tree.nodes[tree.rootId]) {
        return { ok: false, error: `BT rootId '${tree.rootId}' not found in nodes` };
      }
      if (nodeIds.length > maxNodes) {
        return { ok: false, error: `BT too large: ${nodeIds.length} nodes > max ${maxNodes}` };
      }

      for (const id of nodeIds) {
        const n = tree.nodes[id] as any;
        if (!n || typeof n !== 'object') return { ok: false, error: `Invalid node at id '${id}'` };
        if (n.type === 'Action') {
          const name = String(n.name ?? '');
          if (!name) return { ok: false, error: `Action node '${id}' missing name` };
          if (!allowedActions.has(name)) return { ok: false, error: `Unknown action '${name}' at node '${id}'` };
        } else if (n.type === 'Condition') {
          const name = String(n.name ?? '');
          if (!name) return { ok: false, error: `Condition node '${id}' missing name` };
          if (!allowedConditions.has(name)) return { ok: false, error: `Unknown condition '${name}' at node '${id}'` };
        } else if (n.type === 'Sequence' || n.type === 'Fallback') {
          if (!Array.isArray(n.children)) return { ok: false, error: `Composite node '${id}' missing children[]` };
        } else {
          return { ok: false, error: `Unsupported node type '${String(n.type)}' at '${id}'` };
        }
      }

      return { ok: true, tree, vars, btFormat: spec.format };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async function planStep(state: typeof PlanExecuteState.State) {
    nodeLog('planner', { inputPreview: String(state.input ?? '').slice(0, 120) });
    const objective = String(state.input ?? '');
    const lcModel = requireLcModel('planning');
    if (!lcModel?.withStructuredOutput) {
      throw new Error('plan_execute requires lcModel.withStructuredOutput(...) for planning');
    }

    const systemText =
      `${personaBlock}` +
      `You are a Minecraft NPC who is responsible for taking players' instructions and completing them inside the game.\n` +
      `Come up with a simple step-by-step in-game execution plan according to your knowledge regarding Minecraft.\n` +
      `This plan should involve individual tasks in Minecraft that, if executed correctly, will yield the desired result implied by the instruction.\n` +
      `Do not add superfluous steps. Each step should be strictly simpler than the overall instruction.\n` +
      `Make sure each step has all needed info; do not skip steps. Return steps in order.`;
    const planner = lcModel.withStructuredOutput(planSchema);
    // NOTE: @langchain/google-genai currently expects message.role or message.type, but BaseMessage in our @langchain/core
    // exposes _getType()/getType(). Using ChatMessage ensures role is present and avoids "author undefined" crashes.
    const out: any = await planner.invoke([new ChatMessage(systemText, 'system'), new ChatMessage(objective, 'human')]);
    const filtered = (out?.steps ?? []).map((s: string) => String(s).trim()).filter((s: string) => s.length > 0);
    if (typeof onPlan === 'function') await onPlan(filtered);
    return { plan: filtered };
  }

  async function executeStep(state: typeof PlanExecuteState.State) {
    nodeLog('execute_step', { remaining: state.plan?.length ?? 0 });
    const task = state.plan?.[0];
    if (!task) {
      return { response: state.response || 'Done.' };
    }

    const objective = String(state.input ?? '');
    const source = String(state.source ?? '');

    const btRecursionLimit = deps.btRecursionLimit ?? 500;
    const btMaxRepairs = deps.btMaxRepairs ?? 2;
    const btMaxNodes = deps.btMaxNodes ?? 200;

    // Build registry and inject services for BT execution
    const registry = registerDefaultConditions(createDefaultRegistry());
    // Escape hatch: allow BT to call a raw Mindcraft command string.
    // This preserves backwards compatibility with the existing command system while enabling multi-step BTs.
    // registry.registerAction({
    //   name: 'run_command',
    //   schema: z.object({ command: z.string() }),
    //   async run(ctx: RuntimeContext, args): Promise<ActionResult> {
    //     const cmd = String(args.command ?? '');
    //     const cmdName = deps.containsCommand(cmd);
    //     if (!cmdName || !deps.commandExists(cmdName)) {
    //       return { status: 'FAILURE', error: `Invalid command: ${cmd}` };
    //     }
    //     const raw = await deps.executeCommand((ctx.services as any)?.agent ?? (agent as unknown), cmd);
    //     const out = raw ? String(raw) : 'Done.';
    //     return {
    //       status: 'SUCCESS',
    //       updates: { blackboard: { ...(ctx.state.blackboard ?? {}), lastCommandResult: out } },
    //     };
    //   },
    // });

    const allowedActions = new Set(registry.listActions());
    const allowedConditions = new Set(registry.listConditions());

    function zodObjectKeys(schema: any): string[] | null {
      let s = schema;
      // unwrap effects
      while (s?._def?.typeName === 'ZodEffects' && s?._def?.schema) {
        s = s._def.schema;
      }
      if (s?._def?.typeName !== 'ZodObject') return null;
      const shape = typeof s._def.shape === 'function' ? s._def.shape() : s._def.shape;
      if (!shape || typeof shape !== 'object') return null;
      return Object.keys(shape);
    }

    const actionParamHints = registry
      .listActions()
      .map((name) => {
        try {
          const keys = zodObjectKeys((registry as any).getAction(name).schema) ?? [];
          return keys.length > 0 ? `- ${name}: params keys = [${keys.join(', ')}]` : `- ${name}`;
        } catch {
          return `- ${name}`;
        }
      })
      .join('\n');

    const condParamHints = registry
      .listConditions()
      .map((name) => {
        try {
          const keys = zodObjectKeys((registry as any).getCondition(name).schema) ?? [];
          return keys.length > 0 ? `- ${name}: params keys = [${keys.join(', ')}]` : `- ${name}`;
        } catch {
          return `- ${name}`;
        }
      })
      .join('\n');

    const services: Record<string, unknown> = {
      agent,
      capabilities: createMindcraftCapabilities(agent as any),
    };

    const btAuthoringGuide =
      `Write a Behavior Tree to complete the given plan step. The BT must be deterministic and use only allowed actions/conditions.\n` +
      `Prefer format='ir' (JSON IRTree). You MAY use format='xml' if needed.\n` +
      `If format='ir': tree.nodes MUST be an array of nodes; each node MUST have an 'id'. Node.params MUST be an array of {key,value} (both strings). Avoid nested trees.\n` +
      `IMPORTANT: In node.params, each entry is { key: "<param_name>", value: "<string>" } where <param_name> must match the action/condition schema.\n\n` +
      `IMPORTANT: Variable substitution only supports {varName} placeholders (recommended). Avoid 'var.foo' unless the variable is literally named 'foo'.\n` +
      `Recommended pattern for \"find/clear area\" without inventing coordinates:\n` +
      `- Action sense_nearby_blocks types=\"grass_block,dirt\" max_distance=\"16\" set=\"nearbyBlocks\"\n` +
      `- Condition bb_nonempty key=\"nearbyBlocks\"\n` +
      `- Action goto_block_from_bb from=\"nearbyBlocks\" index=\"0\" min_distance=\"2\" (optional)\n` +
      `- Action break_block_from_bb from=\"nearbyBlocks\" index=\"0\" (repeat via replanning/repair; keep BT small)\n\n` +
      `Allowed Actions (with param keys):\n${actionParamHints}\n\n` +
      `Allowed Conditions (with param keys):\n${condParamHints}\n\n` +
      `Constraints:\n` +
      `- Max nodes: ${btMaxNodes}\n` +
      `- Use Sequence/Fallback + Action/Condition nodes only.\n` +
      `- Use vars for placeholders; you may assume vars.player='${source || 'player'}' when relevant.\n`;

    const baseVars: Record<string, string> = {};
    if (source) baseVars.player = source;

    const attemptSummaries: string[] = [];
    const debugEvents: Array<{ ts: number; attempt: number; stage: string; msg: string }> = [];
    function dbg(attemptNum: number, stage: string, msg: string) {
      const m = trunc(msg, 1400);
      debugEvents.push({ ts: Date.now(), attempt: attemptNum, stage, msg: m });
      nodeLog('bt_debug', { attempt: attemptNum, stage, msg: trunc(m, 400) });
    }

    for (let attempt = 0; attempt <= btMaxRepairs; attempt++) {
      const isRepair = attempt > 0;
      nodeLog('bt_attempt_start', {
        attempt: attempt + 1,
        isRepair,
        taskPreview: trunc(task, 160),
        objectivePreview: trunc(objective, 160),
        btMaxNodes,
        btMaxRepairs,
        btRecursionLimit,
      });

      // --- 1) Ask LLM for BT spec (structured output preferred) ---
      let spec: z.infer<typeof btSpecSchema> | null = null;
      const btSystem = `${personaBlock}${btAuthoringGuide}`;
      const btUser =
        `Objective:\n${objective}\n\n` +
        `Plan step:\n${task}\n\n` +
        (isRepair ? `Previous attempt failures:\n${attemptSummaries.join('\n')}\n\n` : '') +
        `Return a BT spec now.`;

      try {
        const lcModel = requireLcModel('BT generation');
        if (!lcModel?.withStructuredOutput) throw new Error('lcModel.withStructuredOutput missing');
        const runner = lcModel.withStructuredOutput(btSpecSchema);
        const out: any = await runner.invoke([new ChatMessage(btSystem, 'system'), new ChatMessage(btUser, 'human')]);
        spec = out as any;
        dbg(attempt + 1, 'structured_output_ok', JSON.stringify(spec));
      } catch (err) {
        nodeLog('bt_spec_structured_failed', { err: String(err) });
        dbg(attempt + 1, 'structured_output_error', String(err));
      }

      if (!spec) {
        // We no longer allow the non-LangChain JSON fallback, because it cannot guarantee schema adherence.
        const detail = `BT generation failed: structured output did not produce a valid btSpecSchema.`;
        attemptSummaries.push(detail);
        dbg(attempt + 1, 'no_fallback', detail);
        continue;
      }

      // Spec summary (helps spot missing fields / huge trees / wrong shape quickly)
      try {
        const summary =
          spec.format === 'ir'
            ? `format=ir rootId=${(spec.tree as any)?.rootId} nodes=${Array.isArray((spec.tree as any)?.nodes) ? (spec.tree as any).nodes.length : 0} vars=${Array.isArray(spec.vars) ? spec.vars.length : 0}`
            : `format=xml xmlLen=${String(spec.xml ?? '').length} vars=${Array.isArray(spec.vars) ? spec.vars.length : 0}`;
        dbg(attempt + 1, 'spec_summary', summary);
      } catch (err) {
        dbg(attempt + 1, 'spec_summary_error', String(err));
      }

      // --- 2) Validate + normalize BT into IRTree ---
      const valid = validateBtSpec(spec, { allowedActions, allowedConditions, maxNodes: btMaxNodes });
      if (!valid.ok) {
        const detail = `BT validation failed: ${valid.error}\nSpec:\n${trunc(JSON.stringify(spec), 1400)}`;
        attemptSummaries.push(detail);
        dbg(attempt + 1, 'validation_failed', detail);
        continue;
      }

      dbg(
        attempt + 1,
        'validation_ok',
        `btFormat=${valid.btFormat} rootId=${valid.tree.rootId} nodes=${Object.keys(valid.tree.nodes ?? {}).length} vars=${Object.keys(valid.vars ?? {}).length}`,
      );

      const vars = { ...baseVars, ...(valid.vars ?? {}) };

      // --- 3) Execute BT to terminal ---
      const btState = createInitialState(valid.tree, vars);
      let status: 'SUCCESS' | 'FAILURE' | 'RUNNING' = 'RUNNING';
      for (let i = 0; i < btRecursionLimit; i++) {
        const res = await tick(btState, registry, { services });
        status = res.status;
        if (status === 'SUCCESS' || status === 'FAILURE') break;
      }
      if (status === 'RUNNING') status = 'FAILURE';

      const logsTail = btState.logs.slice(-30).map((l) => l.msg).join('\n');
      dbg(attempt + 1, 'bt_terminal', `status=${status}\nlogsTail:\n${logsTail || '(no logs)'}`);

      const detail = `BT ${status}. Logs tail:\n${logsTail || '(no logs)'}`;

      if (status === 'SUCCESS') {
        if (typeof onStep === 'function') await onStep(task, 'BT SUCCESS');
        return {
          stepAttempts: [{ step: task, status: 'SUCCESS', detail, attempt: attempt + 1, btFormat: valid.btFormat }],
          lastBtDebug: trunc(JSON.stringify({ attemptSummaries, debugEvents }, null, 2), 4000),
          pastSteps: [[task, 'BT SUCCESS']],
          plan: state.plan.slice(1),
        };
      }

      // FAILURE: record attempt and try repair (if any remaining)
      attemptSummaries.push(detail);
      if (attempt >= btMaxRepairs) {
        if (typeof onStep === 'function') await onStep(task, 'BT FAILURE');
        return {
          stepAttempts: [{ step: task, status: 'FAILURE', detail, attempt: attempt + 1, btFormat: valid.btFormat }],
          lastBtDebug: trunc(JSON.stringify({ attemptSummaries, debugEvents }, null, 2), 4000),
          pastSteps: [[task, 'BT FAILURE']],
          // Do NOT advance plan; replanner decides what to do next.
          plan: state.plan,
        };
      }
    }

    // If we got here, we failed to even generate/validate a BT within repair budget.
    const failDetail = attemptSummaries.slice(-1)[0] ?? 'BT generation/validation failed';
    if (typeof onStep === 'function') await onStep(task, 'BT GENERATION FAILURE');
    return {
      stepAttempts: [{ step: task, status: 'FAILURE', detail: failDetail, attempt: btMaxRepairs + 1 }],
      lastBtDebug: trunc(JSON.stringify({ attemptSummaries, debugEvents }, null, 2), 4000),
      pastSteps: [[task, 'BT GENERATION FAILURE']],
      plan: state.plan,
    };
  }

  async function replanStep(state: typeof PlanExecuteState.State) {
    nodeLog('replan', { remaining: state.plan?.length ?? 0, pastSteps: state.pastSteps?.length ?? 0 });
    const input = String(state.input ?? '');
    const plan = (state.plan ?? []).join('\n');
    const pastSteps = (state.pastSteps ?? []).map(([s, r]) => `${s}: ${r}`).join('\n');
    const attempts = (state.stepAttempts ?? [])
      .map((a) => `Attempt ${a.attempt} for "${a.step}": ${a.status}\n${a.detail}`)
      .join('\n\n');

    // plan_execute requires tool calling for replanning (no legacy JSON fallback).
    const lcModel = requireLcModel('replanning');
    if (!lcModel?.bindTools) {
      throw new Error('plan_execute requires lcModel.bindTools(...) for replanning');
    }
    try {
        const planTool = tool(() => {}, {
          name: 'plan',
          description: 'This tool is used to plan the steps to follow.',
          schema: planSchema,
        });
        const responseTool = tool(() => {}, {
          name: 'response',
          description: 'Respond to the user.',
          schema: responseSchema,
        });
        const parser = new JsonOutputToolsParser();
        const replannerSystem =
          `${personaBlock}` +
          `You are a replanner for a Minecraft NPC. Update the remaining plan based on execution attempts.\n` +
          `Use tool 'response' if you can answer the user now, otherwise use tool 'plan' with only the remaining steps.`;
        const replannerUser =
          `Objective:\n${input}\n\n` +
          `Remaining plan:\n${plan}\n\n` +
          `Execution history (attempts):\n${pastSteps}\n\n` +
          `Detailed attempt logs:\n${attempts}`;

        const toolModel = lcModel.bindTools([planTool, responseTool]);
        const aiMsg: any = await toolModel.invoke([new ChatMessage(replannerSystem, 'system'), new ChatMessage(replannerUser, 'human')]);
        const toolCalls: any = await parser.invoke(aiMsg);

        const first = Array.isArray(toolCalls) ? toolCalls[0] : toolCalls;
        const name = first?.type ?? first?.name;
        const args = first?.args ?? first?.arguments ?? first;

        if (name === 'response') {
          return { response: String(args?.response ?? 'Done.') };
        }
        if (name === 'plan') {
          const steps = (args?.steps ?? []).map((s: string) => String(s).trim()).filter((s: string) => s.length > 0);
          if (steps.length === 0) return { response: 'Done.' };
          if (typeof onReplan === 'function') await onReplan(steps);
          return { plan: steps };
        }
    } catch (err) {
      nodeLog('replan_toolcall_failed', { err: String(err) });
      return { response: `Replanning failed: ${String(err)}` };
    }
  }

  function shouldEnd(state: typeof PlanExecuteState.State) {
    return state.response && String(state.response).trim().length > 0 ? 'endNode' : 'continue';
  }

  const g = new StateGraph(PlanExecuteState)
    .addNode('planner', planStep)
    .addNode('execute_step', executeStep)
    .addNode('replan', replanStep)
    .addEdge(START, 'planner')
    .addEdge('planner', 'execute_step')
    .addEdge('execute_step', 'replan')
    .addConditionalEdges('replan', shouldEnd, {
      endNode: END,
      continue: 'execute_step',
    });

  return { app: g.compile(), formatPlan };
}

export async function runPlanAndExecute(
  agent: PlanExecuteAgentLike,
  deps: PlanExecuteDeps,
  source: string,
  message: string,
  { recursionLimit = 50 }: { recursionLimit?: number } = {},
) {
  const { app, formatPlan: fmtPlan } = buildPlanExecuteGraph(agent, deps, {
    onPlan: async (steps) => {
      const planText = fmtPlan(steps);
      if (planText) agent.routeResponse(source, `Plan: ${planText}`);
    },
    onStep: async (step, result) => {
      agent.routeResponse(source, `Step done: ${step}`);
      if (result && result !== 'Done.') {
        agent.routeResponse(source, String(result));
      }
    },
    onReplan: async (steps) => {
      const planText = fmtPlan(steps);
      if (planText) agent.routeResponse(source, `Updated plan: ${planText}`);
    },
  });

  const out = await app.invoke(
    {
      input: message,
      source,
      plan: [],
      pastSteps: [],
      stepAttempts: [],
      lastBtDebug: '',
      response: '',
    },
    { recursionLimit },
  );

  if (out.response) {
    agent.routeResponse(source, out.response);
  }
}


