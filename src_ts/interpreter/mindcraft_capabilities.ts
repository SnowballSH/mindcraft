import { createRequire } from 'module';
import type {
  InventorySnapshot,
  MindcraftCapabilities,
  NearbyBlock,
  NearbyEntity,
  NearbyPlayer,
  Vec3,
} from './capabilities.js';

const require = createRequire(import.meta.url);
const skills = require('../../src/agent/library/skills.js') as any;
const world = require('../../src/agent/library/world.js') as any;

function toVec3(p: any): Vec3 {
  return { x: Number(p?.x ?? 0), y: Number(p?.y ?? 0), z: Number(p?.z ?? 0) };
}

export function createMindcraftCapabilities(agent: any): MindcraftCapabilities {
  if (!agent?.bot) throw new Error('createMindcraftCapabilities: missing agent.bot');

  return {
    navigate: {
      async toPlayer(player: string, minDistance = 3): Promise<void> {
        await skills.goToPlayer(agent.bot, player, minDistance);
      },
      async toPosition(x: number, y: number, z: number, minDistance = 2): Promise<void> {
        await skills.goToPosition(agent.bot, x, y, z, minDistance);
      },
      async moveAway(distance: number): Promise<void> {
        await skills.moveAway(agent.bot, distance);
      },
    },
    gather: {
      async collectBlocks(type: string, count = 1): Promise<void> {
        await skills.collectBlock(agent.bot, type, count);
      },
    },
    craft: {
      async craftRecipe(item: string, count = 1): Promise<void> {
        await skills.craftRecipe(agent.bot, item, count);
      },
      async smeltItem(item: string, count = 1): Promise<void> {
        await skills.smeltItem(agent.bot, item, count);
      },
    },
    combat: {
      async attackNearest(mobType: string, kill = true): Promise<boolean> {
        return Boolean(await skills.attackNearest(agent.bot, mobType, kill));
      },
      async avoidEnemies(distance = 16): Promise<void> {
        await skills.avoidEnemies(agent.bot, distance);
      },
    },
    survival: {
      async eat(itemName: string): Promise<boolean> {
        return Boolean(await skills.eat(agent.bot, itemName));
      },
      async goToBed(): Promise<void> {
        await skills.goToBed(agent.bot);
      },
    },
    build: {
      async placeBlock(blockType: string, x: number, y: number, z: number, placeOn = 'bottom'): Promise<boolean> {
        return Boolean(await skills.placeBlock(agent.bot, blockType, x, y, z, placeOn));
      },
      async breakBlockAt(x: number, y: number, z: number): Promise<boolean> {
        return Boolean(await skills.breakBlockAt(agent.bot, x, y, z));
      },
    },
    sense: {
      async nearbyPlayers(maxDistance = 16): Promise<NearbyPlayer[]> {
        const players = world.getNearbyPlayers(agent.bot, maxDistance) as any[];
        return players
          .map((p) => ({
            username: String(p?.username ?? ''),
            distance: Number(agent.bot.entity.position.distanceTo(p.position)),
            position: toVec3(p.position),
          }))
          .filter((p) => p.username.length > 0)
          .sort((a, b) => a.distance - b.distance);
      },
      async nearbyEntities(maxDistance = 16): Promise<NearbyEntity[]> {
        const entities = world.getNearbyEntities(agent.bot, maxDistance) as any[];
        return entities
          .map((e) => ({
            id: Number(e?.id ?? -1),
            name: String(e?.name ?? ''),
            type: String(e?.type ?? ''),
            distance: Number(agent.bot.entity.position.distanceTo(e.position)),
            position: toVec3(e.position),
          }))
          .filter((e) => e.id >= 0 && e.name.length > 0)
          .sort((a, b) => a.distance - b.distance);
      },
      async nearbyBlocks(types: string[] | null, maxDistance = 16, count = 50): Promise<NearbyBlock[]> {
        const blocks = world.getNearestBlocks(agent.bot, types, maxDistance, count) as any[];
        return blocks
          .filter((b) => b && b.name && b.position)
          .map((b) => ({ name: String(b.name), position: toVec3(b.position) }));
      },
      async inventory(): Promise<InventorySnapshot> {
        const inv = world.getInventoryCounts(agent.bot) as Record<string, number>;
        return inv ?? {};
      },
    },
  };
}


