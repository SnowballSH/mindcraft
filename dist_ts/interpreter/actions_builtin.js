import { z } from 'zod';
import { Registry } from './registry.js';
function requireAgent(ctx) {
    const agent = (ctx.services?.agent ?? null);
    if (!agent)
        throw new Error('Missing agent in runtime context: ctx.services.agent');
    return agent;
}
function requireCapabilities(ctx) {
    const caps = (ctx.services?.capabilities ?? null);
    if (!caps)
        throw new Error('Missing capabilities in runtime context: ctx.services.capabilities');
    return caps;
}
function camelToSnake(name) {
    return name
        .replace(/^!/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/-/g, '_')
        .toLowerCase();
}
function registerActionWithAliases(r, name, schema, run) {
    const snakeName = camelToSnake(name);
    if (!r.hasAction(name))
        r.registerAction({ name, schema, run });
    if (!r.hasAction(snakeName))
        r.registerAction({ name: snakeName, schema, run });
}
export function createDefaultRegistry() {
    const r = new Registry();
    // Option B (primitives-first): register deterministic actions backed by capabilities.
    registerActionWithAliases(r, 'goto_player', z.object({
        player: z.string(),
        min_distance: z.coerce.number().int().min(0).default(3),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        await caps.navigate.toPlayer(args.player, args.min_distance);
        return { status: 'SUCCESS' };
    });
    registerActionWithAliases(r, 'goto_position', z.object({
        x: z.coerce.number(),
        y: z.coerce.number(),
        z: z.coerce.number(),
        min_distance: z.coerce.number().int().min(0).default(2),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        await caps.navigate.toPosition(args.x, args.y, args.z, args.min_distance);
        return { status: 'SUCCESS' };
    });
    registerActionWithAliases(r, 'sense_nearby_players', z.object({
        max_distance: z.coerce.number().int().min(1).default(16),
        set: z.string().default('nearbyPlayers'),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const out = await caps.sense.nearbyPlayers(args.max_distance);
        return {
            status: 'SUCCESS',
            updates: { blackboard: { ...ctx.state.blackboard, [args.set]: out } },
        };
    });
    registerActionWithAliases(r, 'sense_nearby_entities', z.object({
        max_distance: z.coerce.number().int().min(1).default(16),
        set: z.string().default('nearbyEntities'),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const out = await caps.sense.nearbyEntities(args.max_distance);
        return {
            status: 'SUCCESS',
            updates: { blackboard: { ...ctx.state.blackboard, [args.set]: out } },
        };
    });
    registerActionWithAliases(r, 'sense_nearby_blocks', z.object({
        // Comma-separated list in XML, e.g. types="oak_log,birch_log". Empty or omitted => all.
        types: z.string().optional(),
        max_distance: z.coerce.number().int().min(1).default(16),
        count: z.coerce.number().int().min(1).max(10000).default(50),
        set: z.string().default('nearbyBlocks'),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const types = args.types && args.types.trim().length > 0
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
    });
    // --- Phase 2: inventory + gather/craft/smelt (deterministic primitives) ---
    registerActionWithAliases(r, 'sense_inventory', z.object({
        set: z.string().default('inventory'),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const out = await caps.sense.inventory();
        return {
            status: 'SUCCESS',
            updates: { blackboard: { ...ctx.state.blackboard, [args.set]: out } },
        };
    });
    registerActionWithAliases(r, 'collect_blocks', z.object({
        type: z.string(),
        count: z.coerce.number().int().min(1).default(1),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        await caps.gather.collectBlocks(args.type, args.count);
        return { status: 'SUCCESS' };
    });
    registerActionWithAliases(r, 'craft_recipe', z.object({
        item: z.string(),
        count: z.coerce.number().int().min(1).default(1),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        await caps.craft.craftRecipe(args.item, args.count);
        return { status: 'SUCCESS' };
    });
    registerActionWithAliases(r, 'smelt_item', z.object({
        item: z.string(),
        count: z.coerce.number().int().min(1).default(1),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        await caps.craft.smeltItem(args.item, args.count);
        return { status: 'SUCCESS' };
    });
    // --- Phase 3: combat/survival ---
    registerActionWithAliases(r, 'avoid_enemies', z.object({
        distance: z.coerce.number().int().min(1).default(16),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        await caps.combat.avoidEnemies(args.distance);
        return { status: 'SUCCESS' };
    });
    registerActionWithAliases(r, 'attack_nearest', z.object({
        mob_type: z.string(),
        kill: z.coerce.boolean().default(true),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const ok = await caps.combat.attackNearest(args.mob_type, args.kill);
        return { status: ok ? 'SUCCESS' : 'FAILURE' };
    });
    registerActionWithAliases(r, 'eat', z.object({
        item: z.string(),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const ok = await caps.survival.eat(args.item);
        return { status: ok ? 'SUCCESS' : 'FAILURE' };
    });
    registerActionWithAliases(r, 'go_to_bed', z.object({}), async (ctx) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        await caps.survival.goToBed();
        return { status: 'SUCCESS' };
    });
    // --- Phase 4: building/construction primitives ---
    registerActionWithAliases(r, 'place_block', z.object({
        block: z.string(),
        x: z.coerce.number(),
        y: z.coerce.number(),
        z: z.coerce.number(),
        face: z.enum(['bottom', 'top', 'north', 'south', 'east', 'west']).default('bottom'),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const ok = await caps.build.placeBlock(args.block, args.x, args.y, args.z, args.face);
        return { status: ok ? 'SUCCESS' : 'FAILURE' };
    });
    registerActionWithAliases(r, 'break_block', z.object({
        x: z.coerce.number(),
        y: z.coerce.number(),
        z: z.coerce.number(),
    }), async (ctx, args) => {
        requireAgent(ctx);
        const caps = requireCapabilities(ctx);
        const ok = await caps.build.breakBlockAt(args.x, args.y, args.z);
        return { status: ok ? 'SUCCESS' : 'FAILURE' };
    });
    // Backwards-compatible aliases used by the BT demo / earlier XML.
    // if (!r.hasAction('goto_player')) {
    //   r.registerAction({
    //     name: 'goto_player',
    //     schema: z.object({ player: z.string(), closeness: z.coerce.number().default(2) }),
    //     async run(ctx, args): Promise<ActionResult> {
    //       const agent = requireAgent(ctx);
    //       const adapter = getAdapter(ctx);
    //       const res = await adapter.execCommand(agent, '!goToPlayer', [(args as any).player, (args as any).closeness]);
    //       return { status: res.ok ? 'SUCCESS' : 'FAILURE' };
    //     },
    //   });
    // }
    // if (!r.hasAction('give_player')) {
    //   r.registerAction({
    //     name: 'give_player',
    //     schema: z.object({ player: z.string(), item: z.string(), count: z.coerce.number().int().min(1) }),
    //     async run(ctx, args): Promise<ActionResult> {
    //       const agent = requireAgent(ctx);
    //       const adapter = getAdapter(ctx);
    //       const res = await adapter.execCommand(agent, '!givePlayer', [(args as any).player, (args as any).item, (args as any).count]);
    //       return { status: res.ok ? 'SUCCESS' : 'FAILURE' };
    //     },
    //   });
    // }
    // // --- Action: obtain_item (deterministic service-backed, RUNNING-capable) ---
    // const obtainItemArgsSchema = z.object({
    //   item: z.string(),
    //   count: z.coerce.number().int().min(1).default(1),
    // });
    // type ObtainItemArgs = z.output<typeof obtainItemArgsSchema>;
    // type ObtainItemResumeToken = { attempts: number };
    // const obtainItemStep = async (ctx: RuntimeContext, args: ObtainItemArgs, token?: ObtainItemResumeToken): Promise<ActionResult> => {
    //   const agent = requireAgent(ctx);
    //   const inv = world.getInventoryCounts(agent.bot) as Record<string, number>;
    //   const have = inv[args.item] ?? 0;
    //   if (have >= args.count) {
    //     return { status: 'SUCCESS' };
    //   }
    //   // Start or reuse an ItemGoal instance per BT run
    //   let itemGoal = ctx.services?.itemGoal as any | undefined;
    //   if (!itemGoal) {
    //     itemGoal = new ItemGoal(agent);
    //     if (!ctx.services) ctx.services = {};
    //     ctx.services.itemGoal = itemGoal;
    //   }
    //   // Execute at most one sub-step
    //   await itemGoal.executeNext(args.item, args.count);
    //   const invAfter = world.getInventoryCounts(agent.bot) as Record<string, number>;
    //   const haveAfter = invAfter[args.item] ?? 0;
    //   if (haveAfter >= args.count) {
    //     return { status: 'SUCCESS' };
    //   }
    //   const attempts = (token?.attempts ?? 0) + 1;
    //   return { status: 'RUNNING', resumeToken: { attempts } satisfies ObtainItemResumeToken };
    // };
    // r.registerAction({
    //   name: 'obtain_item',
    //   schema: obtainItemArgsSchema,
    //   async run(ctx, args: ObtainItemArgs): Promise<ActionResult> {
    //     return obtainItemStep(ctx, args);
    //   },
    //   async resume(ctx, args: ObtainItemArgs, resumeToken): Promise<ActionResult> {
    //     return obtainItemStep(ctx, args, resumeToken as ObtainItemResumeToken);
    //   },
    // });
    return r;
}
