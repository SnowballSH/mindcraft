import { z } from 'zod';
import { createRequire } from 'module';
import { Registry } from './registry.js';
import { defaultMindcraftAdapter } from './mindcraft_adapter.js';
const require = createRequire(import.meta.url);
const { ItemGoal } = require('../../src/agent/npc/item_goal.js');
const world = require('../../src/agent/library/world.js');
const { actionsList } = require('../../src/agent/commands/actions.js');
const { queryList } = require('../../src/agent/commands/queries.js');
function requireAgent(ctx) {
    const agent = (ctx.services?.agent ?? null);
    if (!agent)
        throw new Error('Missing agent in runtime context: ctx.services.agent');
    return agent;
}
function getAdapter(ctx) {
    return ctx.services?.mindcraftAdapter ?? defaultMindcraftAdapter;
}
function camelToSnake(name) {
    return name
        .replace(/^!/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/-/g, '_')
        .toLowerCase();
}
function zodForParamType(t) {
    switch (t) {
        case 'int':
            return z.coerce.number().int();
        case 'float':
            return z.coerce.number();
        case 'boolean':
            return z.coerce.boolean();
        case 'BlockName':
        case 'ItemName':
        case 'BlockOrItemName':
        case 'string':
        default:
            return z.string();
    }
}
function applyDomain(schema, domain) {
    if (!domain)
        return schema;
    if (!(schema instanceof z.ZodNumber))
        return schema;
    const lower = domain[0];
    const upper = domain[1];
    const endpointType = domain[2] ?? '[)';
    let out = schema;
    if (Number.isFinite(lower)) {
        out = endpointType[0] === '(' ? out.gt(lower) : out.gte(lower);
    }
    if (Number.isFinite(upper)) {
        out = endpointType[1] === ')' ? out.lt(upper) : out.lte(upper);
    }
    return out;
}
function buildArgsSchema(params) {
    if (!params || Object.keys(params).length === 0) {
        return z.object({}).strip();
    }
    const shape = {};
    for (const [name, spec] of Object.entries(params)) {
        const base = zodForParamType(spec.type);
        shape[name] = applyDomain(base, spec.domain);
    }
    return z.object(shape).strip();
}
function registerMindcraftCommandAsAction(r, cmd) {
    const commandName = cmd.name;
    const actionName = commandName.startsWith('!') ? commandName.slice(1) : commandName;
    const snakeName = camelToSnake(actionName);
    const schema = buildArgsSchema(cmd.params);
    const paramOrder = cmd.params ? Object.keys(cmd.params) : [];
    const run = async (ctx, args) => {
        const agent = requireAgent(ctx);
        const adapter = getAdapter(ctx);
        const argv = paramOrder.map((k) => args[k]);
        const res = await adapter.execCommand(agent, commandName, argv);
        return { status: res.ok ? 'SUCCESS' : 'FAILURE' };
    };
    // Register both camelCase and snake_case names for convenience.
    if (!r.hasAction(actionName)) {
        r.registerAction({ name: actionName, schema, run });
    }
    if (!r.hasAction(snakeName)) {
        r.registerAction({ name: snakeName, schema, run });
    }
}
export function createDefaultRegistry() {
    const r = new Registry();
    for (const cmd of [...actionsList, ...queryList]) {
        registerMindcraftCommandAsAction(r, cmd);
    }
    // Backwards-compatible aliases used by the BT demo / earlier XML.
    if (!r.hasAction('goto_player')) {
        r.registerAction({
            name: 'goto_player',
            schema: z.object({ player: z.string(), closeness: z.coerce.number().default(2) }),
            async run(ctx, args) {
                const agent = requireAgent(ctx);
                const adapter = getAdapter(ctx);
                const res = await adapter.execCommand(agent, '!goToPlayer', [args.player, args.closeness]);
                return { status: res.ok ? 'SUCCESS' : 'FAILURE' };
            },
        });
    }
    if (!r.hasAction('give_player')) {
        r.registerAction({
            name: 'give_player',
            schema: z.object({ player: z.string(), item: z.string(), count: z.coerce.number().int().min(1) }),
            async run(ctx, args) {
                const agent = requireAgent(ctx);
                const adapter = getAdapter(ctx);
                const res = await adapter.execCommand(agent, '!givePlayer', [args.player, args.item, args.count]);
                return { status: res.ok ? 'SUCCESS' : 'FAILURE' };
            },
        });
    }
    // --- Action: obtain_item (deterministic service-backed, RUNNING-capable) ---
    const obtainItemArgsSchema = z.object({
        item: z.string(),
        count: z.coerce.number().int().min(1).default(1),
    });
    const obtainItemStep = async (ctx, args, token) => {
        const agent = requireAgent(ctx);
        const inv = world.getInventoryCounts(agent.bot);
        const have = inv[args.item] ?? 0;
        if (have >= args.count) {
            return { status: 'SUCCESS' };
        }
        // Start or reuse an ItemGoal instance per BT run
        let itemGoal = ctx.services?.itemGoal;
        if (!itemGoal) {
            itemGoal = new ItemGoal(agent);
            if (!ctx.services)
                ctx.services = {};
            ctx.services.itemGoal = itemGoal;
        }
        // Execute at most one sub-step
        await itemGoal.executeNext(args.item, args.count);
        const invAfter = world.getInventoryCounts(agent.bot);
        const haveAfter = invAfter[args.item] ?? 0;
        if (haveAfter >= args.count) {
            return { status: 'SUCCESS' };
        }
        const attempts = (token?.attempts ?? 0) + 1;
        return { status: 'RUNNING', resumeToken: { attempts } };
    };
    r.registerAction({
        name: 'obtain_item',
        schema: obtainItemArgsSchema,
        async run(ctx, args) {
            return obtainItemStep(ctx, args);
        },
        async resume(ctx, args, resumeToken) {
            return obtainItemStep(ctx, args, resumeToken);
        },
    });
    return r;
}
