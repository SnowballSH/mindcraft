import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const skills = require('../../src/agent/library/skills.js');
const world = require('../../src/agent/library/world.js');
function toVec3(p) {
    return { x: Number(p?.x ?? 0), y: Number(p?.y ?? 0), z: Number(p?.z ?? 0) };
}
export function createMindcraftCapabilities(agent) {
    if (!agent?.bot)
        throw new Error('createMindcraftCapabilities: missing agent.bot');
    return {
        navigate: {
            async toPlayer(player, minDistance = 3) {
                await skills.goToPlayer(agent.bot, player, minDistance);
            },
            async toPosition(x, y, z, minDistance = 2) {
                await skills.goToPosition(agent.bot, x, y, z, minDistance);
            },
            async moveAway(distance) {
                await skills.moveAway(agent.bot, distance);
            },
        },
        gather: {
            async collectBlocks(type, count = 1) {
                await skills.collectBlock(agent.bot, type, count);
            },
        },
        craft: {
            async craftRecipe(item, count = 1) {
                await skills.craftRecipe(agent.bot, item, count);
            },
            async smeltItem(item, count = 1) {
                await skills.smeltItem(agent.bot, item, count);
            },
        },
        combat: {
            async attackNearest(mobType, kill = true) {
                return Boolean(await skills.attackNearest(agent.bot, mobType, kill));
            },
            async avoidEnemies(distance = 16) {
                await skills.avoidEnemies(agent.bot, distance);
            },
        },
        survival: {
            async eat(itemName) {
                return Boolean(await skills.eat(agent.bot, itemName));
            },
            async goToBed() {
                await skills.goToBed(agent.bot);
            },
        },
        build: {
            async placeBlock(blockType, x, y, z, placeOn = 'bottom') {
                return Boolean(await skills.placeBlock(agent.bot, blockType, x, y, z, placeOn));
            },
            async breakBlockAt(x, y, z) {
                return Boolean(await skills.breakBlockAt(agent.bot, x, y, z));
            },
        },
        sense: {
            async nearbyPlayers(maxDistance = 16) {
                const players = world.getNearbyPlayers(agent.bot, maxDistance);
                return players
                    .map((p) => ({
                    username: String(p?.username ?? ''),
                    distance: Number(agent.bot.entity.position.distanceTo(p.position)),
                    position: toVec3(p.position),
                }))
                    .filter((p) => p.username.length > 0)
                    .sort((a, b) => a.distance - b.distance);
            },
            async nearbyEntities(maxDistance = 16) {
                const entities = world.getNearbyEntities(agent.bot, maxDistance);
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
            async nearbyBlocks(types, maxDistance = 16, count = 50) {
                const blocks = world.getNearestBlocks(agent.bot, types, maxDistance, count);
                return blocks
                    .filter((b) => b && b.name && b.position)
                    .map((b) => ({ name: String(b.name), position: toVec3(b.position) }));
            },
            async inventory() {
                const inv = world.getInventoryCounts(agent.bot);
                return inv ?? {};
            },
        },
    };
}
