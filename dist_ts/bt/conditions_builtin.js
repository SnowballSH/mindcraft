import { z } from 'zod';
import { createRequire } from 'module';
import { defaultMindcraftAdapter } from './mindcraft_adapter.js';
const require = createRequire(import.meta.url);
const world = require('../../src/agent/library/world.js');
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
function registerMindcraftQueryAsCondition(r, cmd) {
    const commandName = cmd.name;
    const conditionName = commandName.startsWith('!') ? commandName.slice(1) : commandName;
    const snakeName = camelToSnake(conditionName);
    const schema = buildArgsSchema(cmd.params);
    const paramOrder = cmd.params ? Object.keys(cmd.params) : [];
    const evaluate = async (ctx, args) => {
        const agent = requireAgent(ctx);
        const adapter = getAdapter(ctx);
        const argv = paramOrder.map((k) => args[k]);
        const res = await adapter.execCommand(agent, commandName, argv);
        const key = `last_${snakeName}`;
        const nextVars = { ...ctx.state.vars, [key]: String(res.output ?? '') };
        return {
            status: res.ok ? 'SUCCESS' : 'FAILURE',
            updates: { vars: nextVars },
        };
    };
    if (!r.hasCondition(conditionName)) {
        r.registerCondition({ name: conditionName, schema, evaluate });
    }
    if (!r.hasCondition(snakeName)) {
        r.registerCondition({ name: snakeName, schema, evaluate });
    }
}
export function registerDefaultConditions(r) {
    for (const cmd of queryList) {
        registerMindcraftQueryAsCondition(r, cmd);
    }
    r.registerCondition({
        name: 'has_item',
        schema: z.object({
            item: z.string(),
            count: z.coerce.number().int().min(1).default(1),
        }),
        async evaluate(ctx, args) {
            const count = args.count ?? 1;
            let have = ctx.state.world.inventory[args.item] ?? 0;
            try {
                const agent = (ctx.services?.agent ?? null);
                if (agent?.bot) {
                    const inv = world.getInventoryCounts(agent.bot);
                    have = inv[args.item] ?? 0;
                }
            }
            catch {
                // fallback to ctx.state.world
            }
            return { status: have >= count ? 'SUCCESS' : 'FAILURE' };
        },
    });
    return r;
}
