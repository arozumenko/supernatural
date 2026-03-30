// ============================================================
// World Generation & Resource Configuration
// All tunable parameters in one place.
// ============================================================

import { TileType } from '../shared/src/index.ts';

export const WorldConfig = {
  // ─── Terrain ───
  water: {
    minCoverage: 0.20,        // minimum 20% of total map
    lakeMargin: 8,            // min distance from map edge for lake centers
    lakeRadiusX: { min: 6, max: 14 },
    lakeRadiusY: { min: 5, max: 11 },
    noiseDistortion: 0.5,     // how much noise warps lake edges
    maxAttempts: 50,          // max lake placement attempts
    spawnExclusion: 8,        // lake centers avoid this radius around world center
  },
  sand: {
    beachNoiseThreshold: 0.3, // noise value above which sand appears near water
  },
  dirt: {
    elevThreshold: 0.48,      // min elevation for dirt patches
    moistMax: 0.32,           // max moisture for dirt patches
    noiseThreshold: 0.45,     // dirt noise threshold for elevated patches
    clearingThreshold: 0.62,  // dirt noise threshold for scattered clearings
    clearingMoistMax: 0.40,
  },

  // ─── Resource Balance (RESOURCE_BALANCE.md) ───
  natureBudgetRatio: 0.40,    // 40% of placeable land is nature
  distribution: {
    trees: 0.55,              // 55% of nature budget (2x2, 4 tiles each)
    rocks: 0.10,
    berryBush: 0.10,
    mushroom: 0.06,
    poisonShroom: 0.02,
    edibleFlower: 0.04,
    healFlower: 0.04,
    staminaHerb: 0.04,
    hungerHerb: 0.05,
  },

  // ─── Trees ───
  trees: {
    maxHealth: 100,
    stumpLifetimeTicks: 600,  // ~1 min at 10 ticks/sec
    stumpRegrowChance: 0.5,   // 50% regrow vs disappear
    seedDropChance: 0.7,      // 70% chance to drop seed when felled
    growthTicks: { sprout: 300, young: 600 },  // 30s sprout → young, 60s young → mature
  },

  // ─── Rocks ───
  rocks: {
    bigRockRatio: 0.30,       // 30% big, 70% small
    smallHealth: 20,
    bigHealth: 100,
    rubbleLifetimeTicks: 1200, // ~2 min at 10 ticks/sec
    rubbleRespawnChance: 0.6,  // 60% chance to respawn when rubble disappears
  },

  // ─── Plants ───
  plants: {
    bushMaxHealth: 30,
    bushSeedDropChance: 0.9,  // 90% seed drop when bush depleted
    regrowChance: 0.001,      // per tick per existing plant
    growthTicks: { sprout: 150, young: 300 },  // 15s sprout → young, 30s young → mature
  },

  // ─── Iron Ore ───
  iron: {
    depositCount: { min: 15, max: 20 },  // deposits per world
    orePerDeposit: { min: 2, max: 4 },    // iron_ore yielded per deposit
    health: 50,                            // hits to mine out a deposit
  },

  // ─── Agents ───
  agents: {
    initialCount: 8,            // agents spawned at world start
    minPopulation: 5,           // auto-spawn if alive count drops below this
    spawnMaxAttempts: 100,      // max tries to find a grass tile for spawning
  },

  // ─── Spawn Clearing ───
  centerClearing: {
    radius: 5,
  },

  // ─── Animals ───
  animals: {
    maxTotal: 200,
    maxApexTotal: 15,
    spawnCounts: {
      'bear': 2, 'tiger': 1, 'alligator': 2,
      'fox': 3, 'cat': 2, 'dog-0': 3, 'rat': 5,
      'deer': 4, 'cow-0': 3, 'horse': 2,
      'pig': 4, 'goat': 3, 'sheep': 5, 'donkey': 2,
      'rabbit': 6, 'chicken': 5, 'duck': 4, 'squirrel': 4, 'hedgehog': 2, 'capybara': 3,
    } as Record<string, number>,
    // Population control
    lowPreyThreshold: 30,       // if prey < this, double predator breed cooldown
    highPreyThreshold: 150,     // if prey > this, halve predator breed cooldown
    // Day/night cycle
    dayLengthTicks: 1200,       // 2 min = 1 day cycle (600 day + 600 night)
  },

  // ─── Structures ───
  structures: {
    maxHp: {
      [TileType.BUILT_WALL]: 50,
      [TileType.STONE_WALL]: 150,
      [TileType.IRON_WALL]: 300,
      [TileType.WOOD_DOOR]: 30,
      [TileType.BONE_FENCE]: 80,
      [TileType.STORAGE]: 60,
      [TileType.TENT]: 40,
    } as Record<number, number>,
    storageCapacity: 200,        // weight units
    woodDecayRate: 600,          // ticks between 1 HP decay for wooden structures
    woodDecayTiles: [TileType.BUILT_WALL, TileType.WOOD_DOOR, TileType.STORAGE] as number[],
  },
} as const;
