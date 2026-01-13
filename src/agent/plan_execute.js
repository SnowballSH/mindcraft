import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { commandExists, containsCommand, executeCommand, getCommandDocs } from './commands/index.js';

const PlanExecuteState = Annotation.Root({
    input: Annotation({
        reducer: (x, y) => y ?? x ?? '',
    }),
    plan: Annotation({
        reducer: (x, y) => y ?? x ?? [],
    }),
    pastSteps: Annotation({
        reducer: (x, y) => (x ?? []).concat(y ?? []),
    }),
    response: Annotation({
        reducer: (x, y) => y ?? x,
    }),
    decision: Annotation({
        reducer: (x, y) => y ?? x ?? 'plan',
    }),
    directCommand: Annotation({
        reducer: (x, y) => y ?? x ?? '',
    }),
});

function stripCodeFences(text) {
    const t = String(text ?? '').trim();
    if (t.startsWith('```')) {
        const parts = t.split('```');
        if (parts.length >= 3) {
            return parts[1].replace(/^json\s*/i, '').trim();
        }
    }
    return t;
}

function extractJsonObject(text) {
    const t = stripCodeFences(text);
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return t.slice(start, end + 1);
}

async function llmJson(agent, systemPrompt, userPrompt, schema) {
    const turns = [{ role: 'user', content: userPrompt }];
    const raw = await agent.prompter.chat_model.sendRequest(turns, systemPrompt);
    const candidate = extractJsonObject(raw);
    if (!candidate) throw new Error('Failed to parse JSON from model response');
    const parsed = JSON.parse(candidate);
    return schema.parse(parsed);
}

function formatPlan(steps) {
    if (!steps || steps.length === 0) return '';
    return steps.map((s, i) => `${i + 1}) ${s}`).join('  ');
}

const triageSchema = z.object({
    decision: z.enum(['direct_command', 'plan', 'respond']),
    command: z.string().optional(),
    response: z.string().optional(),
});

const planSchema = z.object({
    steps: z.array(z.string()),
});

const replanSchema = z.object({
    action: z.enum(['plan', 'response']),
    steps: z.array(z.string()).optional(),
    response: z.string().optional(),
});

const stepToCommandSchema = z.object({
    command: z.string().describe('A single Mindcraft command string starting with !'),
});

export function buildPlanExecuteGraph(agent, { onPlan, onStep, onReplan } = {}) {
    async function triageStep(state) {
        const docs = getCommandDocs(agent);
        const systemPrompt = `You are a planner-controller for a Minecraft NPC agent. Your job is to decide whether the objective can be done with a single prebuilt command, whether it requires a multi-step plan, or whether to just respond conversationally. Return ONLY valid JSON.`;
        const userPrompt = `Objective: ${state.input}\n\nAvailable commands documentation:\n${docs}\n\nDecide one of: direct_command (provide command), plan, respond (provide response).`;
        const out = await llmJson(agent, systemPrompt, userPrompt, triageSchema);

        if (out.decision === 'direct_command' && out.command) {
            return { decision: 'direct_command', directCommand: out.command };
        }
        if (out.decision === 'respond' && out.response) {
            return { decision: 'respond', response: out.response };
        }
        return { decision: 'plan' };
    }

    async function planStep(state) {
        const systemPrompt = `For the given objective, come up with a simple step by step plan. This plan should involve individual tasks, that if executed correctly will yield the correct result. Do not add any superfluous steps. The result of the final step should finish the objective. Return ONLY valid JSON.`;
        const userPrompt = state.input;
        const plan = await llmJson(agent, systemPrompt, userPrompt, planSchema);
        if (typeof onPlan === 'function') {
            await onPlan(plan.steps);
        }
        return { plan: plan.steps };
    }

    async function executeDirect(state) {
        const raw = state.directCommand;
        const cmd = containsCommand(raw) ? raw : `!${raw.replace(/^!/, '')}`;
        const name = containsCommand(cmd);
        if (!name || !commandExists(name)) {
            return { response: `I tried to run a command but it was invalid: ${cmd}` };
        }
        const result = await executeCommand(agent, cmd);
        return { response: result ? String(result) : 'Done.' };
    }

    async function executeStep(state) {
        const task = state.plan?.[0];
        if (!task) {
            return { response: state.response || 'Done.' };
        }
        const docs = getCommandDocs(agent);
        const systemPrompt = `You are executing ONE plan step as a Minecraft NPC controller. Convert the step into a single Mindcraft command. Only use commands from the provided documentation. Return ONLY valid JSON.`;
        const userPrompt = `Plan step: ${task}\n\nCommands documentation:\n${docs}`;

        let command;
        if (containsCommand(task)) {
            command = task;
        } else {
            const out = await llmJson(agent, systemPrompt, userPrompt, stepToCommandSchema);
            command = out.command;
        }

        const name = containsCommand(command);
        let result;
        if (!name || !commandExists(name)) {
            result = `Invalid command produced for step: ${command}`;
        } else {
            result = await executeCommand(agent, command);
        }

        if (typeof onStep === 'function') {
            await onStep(task, result ? String(result) : 'Done.');
        }

        return {
            pastSteps: [[task, result ? String(result) : 'Done.']],
            plan: state.plan.slice(1),
        };
    }

    async function replanStep(state) {
        const systemPrompt = `You are a replanner. Given the objective, the remaining plan, and the previously completed steps, update the remaining plan. If the objective is already satisfied, respond with action=response and include a response. Otherwise, respond with action=plan and include only the remaining steps. Return ONLY valid JSON.`;

        const userPrompt = `Objective:\n${state.input}\n\nRemaining plan:\n${state.plan.join('\n')}\n\nPast steps:\n${state.pastSteps.map(([s, r]) => `${s}: ${r}`).join('\n')}`;

        const out = await llmJson(agent, systemPrompt, userPrompt, replanSchema);

        if (out.action === 'response') {
            return { response: out.response ?? 'Done.' };
        }

        const nextPlan = (out.steps ?? []).filter((s) => String(s).trim().length > 0);
        if (nextPlan.length === 0) {
            return { response: out.response ?? 'Done.' };
        }
        if (typeof onReplan === 'function') {
            await onReplan(nextPlan);
        }

        return { plan: nextPlan };
    }

    function triageRoute(state) {
        return state.decision === 'direct_command' ? 'direct' : state.decision === 'respond' ? 'respond' : 'plan';
    }

    function shouldEnd(state) {
        return state.response ? 'end' : 'continue';
    }

    const g = new StateGraph(PlanExecuteState)
        .addNode('triage', triageStep)
        .addNode('planner', planStep)
        .addNode('execute_direct', executeDirect)
        .addNode('execute_step', executeStep)
        .addNode('replan', replanStep)
        .addEdge(START, 'triage')
        .addConditionalEdges('triage', triageRoute, {
            direct: 'execute_direct',
            respond: END,
            plan: 'planner',
        })
        .addEdge('planner', 'execute_step')
        .addEdge('execute_step', 'replan')
        .addConditionalEdges('replan', shouldEnd, {
            end: END,
            continue: 'execute_step',
        })
        .addEdge('execute_direct', END);

    const app = g.compile();

    return { app, PlanExecuteState, formatPlan };
}

export async function runPlanAndExecute(agent, source, message, { recursionLimit = 50 } = {}) {
    const { app, formatPlan: fmtPlan } = buildPlanExecuteGraph(agent, {
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
            plan: [],
            pastSteps: [],
            response: '',
            decision: 'plan',
            directCommand: '',
        },
        { recursionLimit },
    );

    if (out.response) {
        agent.routeResponse(source, out.response);
    }

    return true;
}
