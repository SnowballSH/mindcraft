export type Vec3 = { x: number; y: number; z: number };

export type NearbyPlayer = {
  username: string;
  distance: number;
  position: Vec3;
};

export type NearbyEntity = {
  id: number;
  name: string;
  type: string;
  distance: number;
  position: Vec3;
};

export type NearbyBlock = {
  name: string;
  position: Vec3;
};

export type InventorySnapshot = Record<string, number>;

export interface MindcraftCapabilities {
  navigate: {
    toPlayer: (player: string, minDistance?: number) => Promise<void>;
    toPosition: (x: number, y: number, z: number, minDistance?: number) => Promise<void>;
    moveAway: (distance: number) => Promise<void>;
  };
  gather: {
    collectBlocks: (type: string, count?: number) => Promise<void>;
  };
  craft: {
    craftRecipe: (item: string, count?: number) => Promise<void>;
    smeltItem: (item: string, count?: number) => Promise<void>;
  };
  combat: {
    attackNearest: (mobType: string, kill?: boolean) => Promise<boolean>;
    avoidEnemies: (distance?: number) => Promise<void>;
  };
  survival: {
    eat: (itemName: string) => Promise<boolean>;
    goToBed: () => Promise<void>;
  };
  build: {
    placeBlock: (
      blockType: string,
      x: number,
      y: number,
      z: number,
      placeOn?: 'bottom' | 'top' | 'north' | 'south' | 'east' | 'west',
    ) => Promise<boolean>;
    breakBlockAt: (x: number, y: number, z: number) => Promise<boolean>;
  };
  sense: {
    nearbyPlayers: (maxDistance?: number) => Promise<NearbyPlayer[]>;
    nearbyEntities: (maxDistance?: number) => Promise<NearbyEntity[]>;
    nearbyBlocks: (types: string[] | null, maxDistance?: number, count?: number) => Promise<NearbyBlock[]>;
    inventory: () => Promise<InventorySnapshot>;
  };
}


