import { z } from 'zod';
import { Registry } from './registry.js';
import type { RuntimeContext } from './registry.js';
import type { ActionResult } from './types.js';
import { defaultMindcraftAdapter } from './mindcraft_adapter.js';
import { ItemGoal } from '../../src/agent/npc/item_goal.js';
import * as world from '../../src/agent/library/world.js';

function requireAgent(ctx: RuntimeContext): any {
  const agent = (ctx.services?.agent ?? null) as any;
  if (!agent) throw new Error('Missing agent in runtime context: ctx.services.agent');
  return agent;
}

function getAdapter(ctx: RuntimeContext) {
  return (ctx.services?.mindcraftAdapter as any) ?? defaultMindcraftAdapter;
}

export function createDefaultRegistry(): Registry {
  const r = new Registry();

  // --- Action: goto_player ---
  r.registerAction({
    name: 'goto_player',
    schema: z.object({
      player: z.string(),
      closeness: z.coerce.number().default(2),
    }),
    async run(ctx, args: { player: string; closeness: number }): Promise<ActionResult> {
      const agent = requireAgent(ctx);
      const adapter = getAdapter(ctx);
      const res = await adapter.execCommand(agent, '!goToPlayer', [args.player, args.closeness]);
      return { status: res.ok ? 'SUCCESS' : 'FAILURE' };
    },
  });

  // --- Action: give_player ---
  r.registerAction({
    name: 'give_player',
    schema: z.object({
      player: z.string(),
      item: z.string(),
      count: z.coerce.number().int().min(1),
    }),
    async run(ctx, args: { player: string; item: string; count: number }): Promise<ActionResult> {
      const agent = requireAgent(ctx);
      const adapter = getAdapter(ctx);
      const res = await adapter.execCommand(agent, '!givePlayer', [args.player, args.item, args.count]);
      return { status: res.ok ? 'SUCCESS' : 'FAILURE' };
    },
  });

  // --- Action: obtain_item (deterministic service-backed, RUNNING-capable) ---
  const obtainItemArgsSchema = z.object({
    item: z.string(),
    count: z.coerce.number().int().min(1).default(1),
  });

  type ObtainItemArgs = z.output<typeof obtainItemArgsSchema>;
  type ObtainItemResumeToken = { attempts: number };

  const obtainItemStep = async (ctx: RuntimeContext, args: ObtainItemArgs, token?: ObtainItemResumeToken): Promise<ActionResult> => {
    const agent = requireAgent(ctx);

    const inv = world.getInventoryCounts(agent.bot);
    const have = inv[args.item] ?? 0;
    if (have >= args.count) {
      return { status: 'SUCCESS' };
    }

    // Start or reuse an ItemGoal instance per BT run
    let itemGoal = ctx.services?.itemGoal as ItemGoal | undefined;
    if (!itemGoal) {
      itemGoal = new ItemGoal(agent);
      if (!ctx.services) ctx.services = {};
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
    return { status: 'RUNNING', resumeToken: { attempts } satisfies ObtainItemResumeToken };
  };

  r.registerAction({
    name: 'obtain_item',
    schema: obtainItemArgsSchema,
    async run(ctx, args: ObtainItemArgs): Promise<ActionResult> {
      return obtainItemStep(ctx, args);
    },
    async resume(ctx, args: ObtainItemArgs, resumeToken): Promise<ActionResult> {
      return obtainItemStep(ctx, args, resumeToken as ObtainItemResumeToken);
    },
  });

  return r;
}
