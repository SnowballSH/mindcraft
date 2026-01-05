import { z } from 'zod';
import { Registry } from './registry.js';
import type { ConditionResult } from './types.js';

export function registerDefaultConditions(r: Registry): Registry {
  r.registerCondition({
    name: 'has_item',
    schema: z.object({
      item: z.string(),
      count: z.coerce.number().int().min(1).default(1),
    }),
    async evaluate(ctx, args): Promise<ConditionResult> {
      const have = ctx.state.world.inventory[args.item] ?? 0;
      const count = args.count ?? 1;
      return { status: have >= count ? 'SUCCESS' : 'FAILURE' };
    },
  });

  return r;
}
