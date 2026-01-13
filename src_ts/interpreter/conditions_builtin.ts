import { z } from 'zod';
import { createRequire } from 'module';
import { Registry } from './registry.js';
import type { RuntimeContext } from './registry.js';
import type { ConditionResult } from './types.js';
import type { MindcraftCapabilities } from './capabilities.js';

const require = createRequire(import.meta.url);
const world = require('../../src/agent/library/world.js') as any;

function requireAgent(ctx: RuntimeContext): any {
  const agent = (ctx.services?.agent ?? null) as any;
  if (!agent) throw new Error('Missing agent in runtime context: ctx.services.agent');
  return agent;
}

function requireCapabilities(ctx: RuntimeContext): MindcraftCapabilities {
  const caps = (ctx.services?.capabilities ?? null) as any;
  if (!caps) throw new Error('Missing capabilities in runtime context: ctx.services.capabilities');
  return caps as MindcraftCapabilities;
}

export function registerDefaultConditions(r: Registry): Registry {
  // Option B (primitives-first): conditions are real predicates over blackboard/world state.

  // Common LLM mistake: using `sense_nearby_blocks` as a Condition instead of an Action.
  // We support it as a condition alias to reduce brittle BT failures.
  r.registerCondition({
    name: 'sense_nearby_blocks',
    schema: z.object({
      types: z.string().optional(),
      max_distance: z.coerce.number().int().min(1).default(16),
      count: z.coerce.number().int().min(1).max(10000).default(50),
      set: z.string().default('nearbyBlocks'),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      requireAgent(ctx);
      const caps = requireCapabilities(ctx);
      const types =
        args.types && args.types.trim().length > 0
          ? args.types
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : null;
      const out = await caps.sense.nearbyBlocks(types, args.max_distance, args.count);
      return {
        status: 'SUCCESS',
        updates: { blackboard: { ...ctx.state.blackboard, [args.set]: out } },
      };
    },
  });

  r.registerCondition({
    name: 'bb_nonempty',
    schema: z.object({ key: z.string() }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const v = (ctx.state.blackboard ?? ({} as any))[args.key];
      const ok = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined;
      return { status: ok ? 'SUCCESS' : 'FAILURE' };
    },
  });

  r.registerCondition({
    name: 'bb_any_equals',
    schema: z.object({
      key: z.string(),
      field: z.string(),
      value: z.string(),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const v = (ctx.state.blackboard ?? ({} as any))[args.key];
      if (!Array.isArray(v)) return { status: 'FAILURE' };
      const ok = v.some((item: any) => String(item?.[args.field] ?? '') === args.value);
      return { status: ok ? 'SUCCESS' : 'FAILURE' };
    },
  });

  r.registerCondition({
    name: 'bb_any_within',
    schema: z.object({
      key: z.string(),
      field: z.string().default('distance'),
      max: z.coerce.number().min(0),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const v = (ctx.state.blackboard ?? ({} as any))[args.key];
      if (!Array.isArray(v)) return { status: 'FAILURE' };
      const ok = v.some((item: any) => Number(item?.[args.field]) <= args.max);
      return { status: ok ? 'SUCCESS' : 'FAILURE' };
    },
  });

  r.registerCondition({
    name: 'nearby_player_exists',
    schema: z.object({
      username: z.string().optional(),
      max_distance: z.coerce.number().int().min(1).default(16),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      requireAgent(ctx);
      const caps = requireCapabilities(ctx);
      const players = await caps.sense.nearbyPlayers(args.max_distance);
      const ok = args.username
        ? players.some((p) => p.username === args.username)
        : players.length > 0;
      return { status: ok ? 'SUCCESS' : 'FAILURE' };
    },
  });

  // --- Phase 3: basic survival predicates (pure reads from live bot) ---
  // Note: these are predicates; for fully deterministic behavior you can also snapshot into blackboard.

  r.registerCondition({
    name: 'hunger_below',
    schema: z.object({
      threshold: z.coerce.number().int().min(0).max(20).default(18),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const agent = requireAgent(ctx);
      const food = Number(agent?.bot?.food ?? 20);
      return { status: food < args.threshold ? 'SUCCESS' : 'FAILURE' };
    },
  });

  r.registerCondition({
    name: 'health_below',
    schema: z.object({
      threshold: z.coerce.number().int().min(0).max(20).default(10),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const agent = requireAgent(ctx);
      const health = Number(agent?.bot?.health ?? 20);
      return { status: health < args.threshold ? 'SUCCESS' : 'FAILURE' };
    },
  });

  r.registerCondition({
    name: 'has_item',
    schema: z.object({
      item: z.string(),
      count: z.coerce.number().int().min(1).default(1),
      // Optional: name of a blackboard key containing an inventory snapshot.
      // If provided and present, we prefer it to avoid live world polling.
      inventory_key: z.string().default('inventory'),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const count = args.count ?? 1;

      // 1) Prefer blackboard inventory snapshot (Option B pattern: sense_inventory -> has_item)
      const bbInv = (ctx.state.blackboard ?? ({} as any))[args.inventory_key] as any;
      if (bbInv && typeof bbInv === 'object') {
        const haveFromBb = Number((bbInv as any)[args.item] ?? 0);
        return { status: haveFromBb >= count ? 'SUCCESS' : 'FAILURE' };
      }

      // 2) Fallback to ctx.state.world (if host maintains it)
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
