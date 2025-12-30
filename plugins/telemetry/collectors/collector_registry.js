import { DeathCollector } from './death_collector.js';
import { InventoryDeltaCollector } from './inventory_delta_collector.js';
import { EpisodeCollector } from './episode_collector.js';
import { TaskProgressCollector } from './task_progress_collector.js';

export function getCollectorRegistry() {
  return [
    new EpisodeCollector(),
    new DeathCollector(),
    new InventoryDeltaCollector(),
    new TaskProgressCollector(),
  ];
}


