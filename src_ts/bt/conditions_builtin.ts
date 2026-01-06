import { z } from 'zod';
import { createRequire } from 'module';
import { Registry } from './registry.js';
import type { RuntimeContext } from './registry.js';
import type { ConditionResult } from './types.js';
import { defaultMindcraftAdapter } from './mindcraft_adapter.js';

const require = createRequire(import.meta.url);
const world = require('../../src/agent/library/world.js') as any;
const { queryList } = require('../../src/agent/commands/queries.js') as any;

type MindcraftParamType = 'string' | 'int' | 'float' | 'boolean' | 'BlockName' | 'ItemName' | 'BlockOrItemName';

type MindcraftParamSpec = {
  type: MindcraftParamType | string;
  description?: string;
  domain?: [number, number, '[)' | '()' | '(]' | '[]'] | [number, number];
};

type MindcraftCommandSpec = {
  name: string;
  description?: string;
  params?: Record<string, MindcraftParamSpec>;
};

function requireAgent(ctx: RuntimeContext): any {
  const agent = (ctx.services?.agent ?? null) as any;
  if (!agent) throw new Error('Missing agent in runtime context: ctx.services.agent');
  return agent;
}

function getAdapter(ctx: RuntimeContext) {
  return (ctx.services?.mindcraftAdapter as any) ?? defaultMindcraftAdapter;
}

function camelToSnake(name: string): string {
  return name
    .replace(/^!/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

function zodForParamType(t: string): z.ZodTypeAny {
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

function applyDomain(schema: z.ZodTypeAny, domain?: MindcraftParamSpec['domain']): z.ZodTypeAny {
  if (!domain) return schema;
  if (!(schema instanceof z.ZodNumber)) return schema;
  const lower = domain[0];
  const upper = domain[1];
  const endpointType = (domain as any)[2] ?? '[)';

  let out: z.ZodNumber = schema;
  if (Number.isFinite(lower)) {
    out = endpointType[0] === '(' ? out.gt(lower) : out.gte(lower);
  }
  if (Number.isFinite(upper)) {
    out = endpointType[1] === ')' ? out.lt(upper) : out.lte(upper);
  }
  return out;
}

function buildArgsSchema(params?: Record<string, MindcraftParamSpec>): z.ZodTypeAny {
  if (!params || Object.keys(params).length === 0) {
    return z.object({}).strip();
  }
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, spec] of Object.entries(params)) {
    const base = zodForParamType(spec.type);
    shape[name] = applyDomain(base, spec.domain);
  }
  return z.object(shape).strip();
}

function registerMindcraftQueryAsCondition(r: Registry, cmd: MindcraftCommandSpec): void {
  const commandName = cmd.name;
  const conditionName = commandName.startsWith('!') ? commandName.slice(1) : commandName;
  const snakeName = camelToSnake(conditionName);
  const schema = buildArgsSchema(cmd.params);
  const paramOrder = cmd.params ? Object.keys(cmd.params) : [];

  const evaluate = async (ctx: RuntimeContext, args: Record<string, unknown>): Promise<ConditionResult> => {
    const agent = requireAgent(ctx);
    const adapter = getAdapter(ctx);
    const argv = paramOrder.map((k) => (args as any)[k]);
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

export function registerDefaultConditions(r: Registry): Registry {
  for (const cmd of queryList as any as MindcraftCommandSpec[]) {
    registerMindcraftQueryAsCondition(r, cmd);
  }

  r.registerCondition({
    name: 'has_item',
    schema: z.object({
      item: z.string(),
      count: z.coerce.number().int().min(1).default(1),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const count = args.count ?? 1;

      let have = ctx.state.world.inventory[args.item] ?? 0;
      try {
        const agent = (ctx.services?.agent ?? null) as any;
        if (agent?.bot) {
          const inv = world.getInventoryCounts(agent.bot) as Record<string, number>;
          have = inv[args.item] ?? 0;
        }
      } catch {
        // fallback to ctx.state.world
      }

      return { status: have >= count ? 'SUCCESS' : 'FAILURE' };
    },
  });

  return r;
}
