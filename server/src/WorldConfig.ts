// ============================================================
// World Generation & Resource Configuration
// Loads from server/world-config.json, falls back to defaults.
// Edit the JSON file to tune gameplay without touching code.
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TileType } from '../shared/src/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../configs/world-config.json');

// ─── Defaults (used when JSON is missing or incomplete) ───

const DEFAULTS = {
  water: {
    minCoverage: 0.20,
    lakeMargin: 8,
    lakeRadiusX: { min: 6, max: 14 },
    lakeRadiusY: { min: 5, max: 11 },
    noiseDistortion: 0.5,
    maxAttempts: 50,
    spawnExclusion: 8,
  },
  sand: { beachNoiseThreshold: 0.3 },
  dirt: {
    elevThreshold: 0.48,
    moistMax: 0.32,
    noiseThreshold: 0.45,
    clearingThreshold: 0.62,
    clearingMoistMax: 0.40,
  },
  natureBudgetRatio: 0.40,
  distribution: {
    trees: 0.55, rocks: 0.10, berryBush: 0.10, mushroom: 0.06,
    poisonShroom: 0.02, edibleFlower: 0.04, healFlower: 0.04,
    staminaHerb: 0.04, hungerHerb: 0.05,
  },
  trees: {
    maxHealth: 100, stumpLifetimeTicks: 600, stumpRegrowChance: 0.5,
    seedDropChance: 0.7, growthTicks: { sprout: 300, young: 600 },
  },
  rocks: {
    bigRockRatio: 0.30, smallHealth: 20, bigHealth: 100,
    rubbleLifetimeTicks: 1200, rubbleRespawnChance: 0.6,
  },
  plants: {
    bushMaxHealth: 30, bushSeedDropChance: 0.9, regrowChance: 0.003,
    growthTicks: { sprout: 80, young: 150 },
  },
  iron: {
    depositCount: { min: 15, max: 20 }, orePerDeposit: { min: 2, max: 4 }, health: 50,
  },
  agents: { initialCount: 8, minPopulation: 5, spawnMaxAttempts: 100 },
  centerClearing: { radius: 5 },
  animals: {
    maxTotal: 200, maxApexTotal: 15,
    spawnCounts: {
      'bear': 2, 'tiger': 1, 'alligator': 2,
      'fox': 3, 'cat': 2, 'dog-0': 3, 'rat': 5,
      'deer': 4, 'cow-0': 3, 'horse': 2,
      'pig': 4, 'goat': 3, 'sheep': 5, 'donkey': 2,
      'rabbit': 6, 'chicken': 5, 'duck': 4, 'squirrel': 4, 'hedgehog': 2, 'capybara': 3,
    } as Record<string, number>,
    lowPreyThreshold: 30, highPreyThreshold: 150, dayLengthTicks: 1200,
  },
  needs: {
    decayRates: { hunger: 0.15, thirst: 0.2, stamina: 0.05, social: 0.03, shelter: 0.02 },
    restoreAmounts: { eat: 25, drink: 30, rest: 15, social: 10 },
    starvationDamage: { both: 1.5, single: 0.5, dehydration: 1.5, exhaustion: 0.1, exposure: 0.15 },
    healthRegen: { restInterval: 5, restBase: 0.5, restSkillBonus: 0.02, toughnessRegen: 0.002, needsMet: 0.05 },
  },
  combat: {
    attackCooldownBase: 10, attackCooldownMin: 5, attackCooldownSkillDiv: 20,
    killXP: { combat: 150, defense: 80, athletics: 50, survival: 50 },
    killBonusLives: 5, maxLives: 200, cannibalWitnessRange: 15,
    lootFractions: { food: 0.5, meat: 0.5, wood: 0.25, stone: 0.25 },
  },
  harvest: {
    baseWood: 5, baseStone: 5, basePlant: 5, baseIron: 3,
    skillDivisor: 10, bonusYieldChance: 0.005,
  },
  plantNutrition: {
    berryBush: 5, mushroom: 15, poisonDamage: 25, flower: 30,
    staminaHerb: 35, hungerHerb: 20, edibleFlower: 10,
  },
  taming: {
    maxPerAgent: 5, productionInterval: 500,
    meatFraction: 0.3, boneFraction: 0.2, hideFraction: 0.2,
    fatFraction: 0.2, featherFraction: 0.3, feedRestore: 15,
  },
  alliance: {
    maxAllies: 3, baseRelationThreshold: 50, tamedAnimalPenalty: 15,
    shareMinSurplus: 2, shareAmount: 2, shareCriticalNeed: 20,
  },
  respawn: { agentDelayTicks: 300, agentMaxAttempts: 200, ironRespawnInterval: 18000 },
  sampling: { timelineInterval: 100, heatmapInterval: 300, regionRecount: 50 },
  activityMultipliers: {
    idle: 0.6, resting: 0.4, wandering: 1.0, socializing: 0.8,
    building: 1.4, crafting: 1.2, harvesting: 1.5,
    hunting: 1.6, fighting: 1.8, fleeing: 1.3,
  } as Record<string, number>,
  structures: { storageCapacity: 200, woodDecayRate: 600 },
};

// ─── Deep merge: JSON values override defaults ───

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ─── Load JSON config ───

function loadConfig(): typeof DEFAULTS {
  if (!existsSync(CONFIG_PATH)) {
    console.log('No world-config.json found — using defaults');
    return DEFAULTS;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const json = JSON.parse(raw);
    // Remove non-config fields
    delete json.$schema;
    delete json._comment;
    const merged = deepMerge(DEFAULTS, json);
    console.log('Loaded world-config.json');
    return merged;
  } catch (err) {
    console.error('Failed to load world-config.json, using defaults:', err);
    return DEFAULTS;
  }
}

const loaded = loadConfig();

// ─── Export with TileType-dependent fields (can't be in JSON) ───

export const WorldConfig = {
  ...loaded,

  // Structure HP requires TileType enum keys — always from code
  structures: {
    maxHp: {
      [TileType.CAMPFIRE]: 1,
      [TileType.WORKBENCH]: 50,
      [TileType.FORGE]: 80,
      [TileType.BUILT_FLOOR]: 20,
      [TileType.BUILT_WALL]: 50,
      [TileType.STONE_WALL]: 150,
      [TileType.IRON_WALL]: 300,
      [TileType.WOOD_DOOR]: 30,
      [TileType.BONE_FENCE]: 80,
      [TileType.STORAGE]: 60,
      [TileType.TENT]: 40,
      [TileType.BEDROLL]: 15,
      [TileType.ANIMAL_PEN]: 60,
    } as Record<number, number>,
    storageCapacity: loaded.structures.storageCapacity,
    woodDecayRate: loaded.structures.woodDecayRate,
    woodDecayTiles: [TileType.BUILT_WALL, TileType.WOOD_DOOR, TileType.STORAGE, TileType.CAMPFIRE, TileType.WORKBENCH, TileType.BUILT_FLOOR, TileType.BEDROLL] as number[],
  },
};
