/**
 * SharedDecisionEngine — unified survival decision logic for both agents and animals.
 *
 * Extracts the common survival behaviors (drink, eat, flee, hunt, rest) into
 * shared functions that both NeedsSystem and AnimalAI call with different configs.
 */

import {
  TileType, PlantType, clamp, distance,
  SpatialMemoryEntry, WORLD_WIDTH, WORLD_HEIGHT,
} from '../../shared/src/index.ts';
import type { World } from '../World.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';

// ─── Being: shared interface for agents and animals ───

export interface Being {
  x: number;
  y: number;
  health: number;
  maxHealth?: number;        // animals have this, agents use 100
  proteinHunger: number;
  plantHunger: number;
  thirst: number;
  stamina: number;
  baseStats: { strength: number; toughness: number; agility: number; endurance: number; perception: number; charisma: number };
  skills: Record<string, { xp: number; level: number }>;
  alive: boolean;
  action: string;
  lastAttackedBy?: { type: string; id: string; tick: number };
  attackCooldown: number;
  spatialMemory?: SpatialMemoryEntry[];
  age?: number;
}

export interface SurvivalConfig {
  criticalThirst: number;       // below this → priority 95
  criticalHunger: number;       // below this → priority 90
  criticalStamina: number;      // below this → rest
  criticalHealth: number;       // below this → seek healing
  mediumThirst: number;         // below this → medium priority drink
  mediumHunger: number;         // below this → medium priority eat
  drinkPriority: number;        // medium drink priority (e.g. 63)
  eatPriority: number;          // medium eat priority (e.g. 58)
  restPriority: number;         // exhaustion rest priority (e.g. 83)
  searchRadius: number;         // default resource search radius
  criticalSearchRadius: number; // wider search when desperate
  diet: 'carnivore' | 'herbivore' | 'omnivore';
}

export interface ThreatConfig {
  detectBase: number;           // base threat detection range
  fleeBase: number;             // base flee priority
  confidence: number;           // 0-1.5, reduces flee urgency
  desperation: number;          // reduces flee when starving
  huntsList: string[];          // species that hunt this being
}

export interface SharedDecision {
  action: string;
  priority: number;
  target?: { x: number; y: number };
  targetId?: string;
  reason: string;
}

// ─── Survival Needs Evaluation ───

export function evaluateSurvivalNeeds(
  being: Being,
  world: World,
  config: SurvivalConfig,
): SharedDecision[] {
  const decisions: SharedDecision[] = [];
  const ax = Math.floor(being.x);
  const ay = Math.floor(being.y);

  // --- Critical thirst ---
  if (being.thirst < config.criticalThirst) {
    const searchR = config.criticalSearchRadius;
    const water = world.findNearest(ax, ay, TileType.WATER, searchR)
      ?? recallMemory(being, 'water');
    if (water) {
      decisions.push({ action: 'drinking', priority: 95, target: water, reason: 'critically thirsty' });
    } else {
      const sx = ax + Math.floor(Math.random() * 30) - 15;
      const sy = ay + Math.floor(Math.random() * 30) - 15;
      decisions.push({ action: 'wandering', priority: 90, target: { x: clampX(sx), y: clampY(sy) }, reason: 'searching for water (desperate)' });
    }
  }

  // --- Critical hunger ---
  const effectiveHunger = Math.min(being.proteinHunger, being.plantHunger);
  if (effectiveHunger < config.criticalHunger) {
    // Try plants first for non-carnivores
    if (config.diet !== 'carnivore') {
      const foodPlant = world.findNearestPlant(ax, ay,
        [PlantType.BERRY_BUSH, PlantType.MUSHROOM, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER],
        config.criticalSearchRadius);
      if (foodPlant) {
        decisions.push({ action: 'harvesting', priority: 90, target: { x: foodPlant.x, y: foodPlant.y }, targetId: foodPlant.id, reason: 'foraging for food (critical)' });
      }
    }
    // No food found → desperate search
    if (decisions.length === 0 || decisions[decisions.length - 1].priority < 85) {
      const sx = ax + Math.floor(Math.random() * 30) - 15;
      const sy = ay + Math.floor(Math.random() * 30) - 15;
      decisions.push({ action: 'wandering', priority: 85, target: { x: clampX(sx), y: clampY(sy) }, reason: 'searching for food (desperate)' });
    }
  }

  // --- Critical stamina ---
  if (being.stamina < config.criticalStamina) {
    decisions.push({ action: 'resting', priority: config.restPriority, reason: 'exhausted, must rest' });
  }

  // --- Medium thirst ---
  if (being.thirst < config.mediumThirst && being.thirst >= config.criticalThirst) {
    const water = world.findNearest(ax, ay, TileType.WATER, config.searchRadius)
      ?? recallMemory(being, 'water');
    if (water) {
      decisions.push({ action: 'drinking', priority: config.drinkPriority, target: water, reason: 'getting thirsty' });
    } else {
      const sx = ax + Math.floor(Math.random() * 20) - 10;
      const sy = ay + Math.floor(Math.random() * 20) - 10;
      decisions.push({ action: 'wandering', priority: config.drinkPriority - 10, target: { x: clampX(sx), y: clampY(sy) }, reason: 'searching for water' });
    }
  }

  // --- Medium hunger ---
  const medHunger = Math.min(being.proteinHunger, being.plantHunger);
  if (medHunger < config.mediumHunger && medHunger >= config.criticalHunger) {
    if (config.diet !== 'carnivore') {
      const foodPlant = world.findNearestPlant(ax, ay,
        [PlantType.BERRY_BUSH, PlantType.MUSHROOM, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER],
        config.searchRadius);
      if (foodPlant) {
        decisions.push({ action: 'harvesting', priority: config.eatPriority, target: { x: foodPlant.x, y: foodPlant.y }, targetId: foodPlant.id, reason: 'foraging for food' });
      }
    }
  }

  return decisions;
}

// ─── Threat Evaluation ───

export interface Threat {
  entity: { x: number; y: number; id?: string };
  species: string;
  dist: number;
  danger: number;
  isHunting: boolean;
}

export function evaluateThreats(
  being: Being,
  world: World,
  config: ThreatConfig,
  beingType: 'agent' | 'animal',
): SharedDecision[] {
  const decisions: SharedDecision[] = [];
  const isAgent = beingType === 'agent';

  for (const animal of world.animals) {
    if (!animal.alive) continue;
    const species = getSpecies(animal.species);
    if (!species) continue;

    // Determine if this animal is a threat
    const huntsMe = isAgent
      ? (species.hunts?.includes('agent') ?? false)
      : (species.hunts?.includes((being as any).species) ?? false);
    const isAttacking = animal.action === 'hunting' || animal.action === 'fighting';
    const wasMyAttacker = being.lastAttackedBy?.type === 'animal' && being.lastAttackedBy.id === animal.id;

    if (!huntsMe && !isAttacking && !wasMyAttacker) continue;

    const dist = distance(being.x, being.y, animal.x, animal.y);
    const detectRange = isAttacking ? config.detectBase * 2 : config.detectBase;
    if (dist > detectRange) continue;

    const myDefense = 10 + (being.skills.defense?.level ?? 0) * 0.5;
    const healthFactor = being.health > 60 ? 1.0 : being.health / 60;
    const confidence = Math.min(1.5, config.confidence * healthFactor);
    const dangerRatio = species.attack / Math.max(1, myDefense * confidence);

    if (being.health > 50 && dangerRatio < 0.4 * confidence) continue;

    const proximityUrgency = 1 - (dist / detectRange);
    let fleePriority = Math.floor(config.fleeBase + (dangerRatio * proximityUrgency * 35) - (confidence * 10) - config.desperation);
    if (wasMyAttacker) fleePriority = Math.min(fleePriority + 20, 98);

    if (fleePriority > 60) {
      // Smart flee: away from predator, toward resources if possible
      const awayDx = being.x - animal.x;
      const awayDy = being.y - animal.y;
      const len = Math.sqrt(awayDx * awayDx + awayDy * awayDy) || 1;
      let fleeX = Math.floor(being.x + (awayDx / len) * 8);
      let fleeY = Math.floor(being.y + (awayDy / len) * 8);

      // Try to flee toward water if it's in the safe direction
      const water = world.findNearest(Math.floor(being.x), Math.floor(being.y), TileType.WATER, 15);
      if (water) {
        const toWaterDx = water.x - being.x;
        const toWaterDy = water.y - being.y;
        if (toWaterDx * awayDx + toWaterDy * awayDy > 0) {
          fleeX = water.x;
          fleeY = water.y;
        }
      }

      fleeX += Math.floor(Math.random() * 6) - 3;
      fleeY += Math.floor(Math.random() * 6) - 3;

      decisions.push({
        action: isAgent ? 'wandering' : 'fleeing',
        priority: clamp(fleePriority, 60, 98),
        target: { x: clampX(fleeX), y: clampY(fleeY) },
        reason: `threatened by ${species.name}`,
      });
      break; // flee from most dangerous only
    }
  }

  return decisions;
}

// ─── Hunt Evaluation (shared for both agents and animals) ───

export function evaluateHunting(
  being: Being,
  world: World,
  huntRange: number,
  huntBaseWeight: number,
  isStarving: boolean,
): SharedDecision[] {
  const decisions: SharedDecision[] = [];

  for (const animal of world.animals) {
    if (!animal.alive) continue;
    const species = getSpecies(animal.species);
    if (!species) continue;
    const dist = distance(being.x, being.y, animal.x, animal.y);
    if (dist > huntRange) continue;

    const meatValue = species.drops?.meat ?? species.foodDrop ?? 0;
    if (meatValue === 0) continue;

    const myAttack = 10 + (being.skills.combat?.level ?? 0) * 0.5;
    const riskScore = species.attack / Math.max(1, myAttack);
    const rewardScore = meatValue / 15;
    const hungerUrgency = 1 - (being.proteinHunger / 100);

    if (!isStarving && riskScore > 1.5 && hungerUrgency < 0.7) continue;

    let huntPriority = Math.floor(huntBaseWeight - 10 + (rewardScore * hungerUrgency * 30) - (riskScore * 10));
    if (isStarving) huntPriority = Math.max(huntPriority, 75);

    if (huntPriority > huntBaseWeight - 10) {
      decisions.push({
        action: 'harvesting',
        priority: huntPriority,
        target: { x: Math.floor(animal.x), y: Math.floor(animal.y) },
        targetId: animal.id,
        reason: isStarving ? `desperate hunt: ${species.name}` : `hunting ${species.name}`,
      });
      break;
    }
  }

  return decisions;
}

// ─── Helpers ───

function recallMemory(being: Being, type: string): { x: number; y: number } | null {
  if (!being.spatialMemory) return null;
  const maxAge = 3000;
  const age = being.age ?? 0;
  const mem = being.spatialMemory
    .filter(m => m.type === type && (age - m.tick) < maxAge)
    .sort((a, b) => {
      const dA = distance(being.x, being.y, a.x, a.y);
      const dB = distance(being.x, being.y, b.x, b.y);
      return dA - dB;
    })[0];
  return mem ? { x: mem.x, y: mem.y } : null;
}

function clampX(x: number): number { return Math.max(1, Math.min(x, WORLD_WIDTH - 2)); }
function clampY(y: number): number { return Math.max(1, Math.min(y, WORLD_HEIGHT - 2)); }
