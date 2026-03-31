/**
 * BaseNeedsSystem — shared survival logic extracted from NeedsSystem.ts and AnimalAI.ts.
 *
 * Exported as pure functions (not a class) for incremental migration.
 * Both NeedsSystem and AnimalAI will eventually import these instead of
 * duplicating the logic.
 */

import {
  TileType, clamp, distance,
  WORLD_WIDTH, WORLD_HEIGHT,
} from '../../shared/src/index.ts';
import type {
  AnimalState, BehaviorGenome, SkillSet,
} from '../../shared/src/index.ts';
import type { World } from '../World.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';
import { awardXP } from '../Progression.ts';
import type { Being } from './SharedDecisionEngine.ts';

// ─── Decision type returned by all base functions ───

export interface Decision {
  action: string;
  priority: number;
  target?: { x: number; y: number };
  targetId?: string;
  reason: string;
}

// ─── Config for baseDecayNeeds ───

export interface DecayConfig {
  /** 'carnivore' | 'herbivore' | 'omnivore' */
  diet: 'carnivore' | 'herbivore' | 'omnivore';
  /** Animal size category — affects hunger scaling. Agents use 'medium'. */
  size: 'tiny' | 'small' | 'medium' | 'large';
  /** Base hunger decay rate per tick (from species or WorldConfig) */
  hungerDecayRate: number;
  /** Base thirst decay rate per tick */
  thirstDecayRate: number;
  /** Base stamina decay rate per tick */
  staminaDecayRate: number;
  /** Max health cap (100 for agents, species.maxHealth for animals) */
  maxHealth: number;
  /** Starvation damage values — omit to use defaults */
  starvationDamage?: {
    both: number;
    single: number;
    dehydration: number;
    exhaustion: number;
    exposure?: number;
  };
  /** Health regen config when resting — omit for simpler animal regen */
  healthRegen?: {
    restInterval: number;
    restBase: number;
    restSkillBonus: number;
  };
}

// ─── Shared activity→multiplier maps ───

/**
 * Agent activity multipliers (from WorldConfig.activityMultipliers).
 * Kept here as a reference; callers can also pass their own.
 */
const AGENT_ACTIVITY_MULTIPLIERS: Record<string, number> = {
  idle: 0.6, resting: 0.4, wandering: 1.0, socializing: 0.8,
  building: 1.4, crafting: 1.2, harvesting: 1.5,
  hunting: 1.6, fighting: 1.8, fleeing: 1.3,
};

/**
 * Animal activity multipliers (from AnimalAI.ts).
 */
const ANIMAL_ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sleeping: 0.4, curled: 0.5, idle: 0.6,
  grazing: 0.8, following: 0.8,
  wandering: 1.0, breeding: 1.0, traveling: 1.0, guarding: 1.0,
  stalking: 1.2, fleeing: 1.3,
  hunting: 1.6, fighting: 1.8,
  dying: 0,
};

// ─── Helpers ───

function clampX(x: number): number { return Math.max(1, Math.min(x, WORLD_WIDTH - 2)); }
function clampY(y: number): number { return Math.max(1, Math.min(y, WORLD_HEIGHT - 2)); }

function getSizeMultiplier(size: DecayConfig['size']): number {
  switch (size) {
    case 'tiny': return 0.5;
    case 'small': return 0.75;
    case 'medium': return 1.0;
    case 'large': return 1.5;
  }
}

/** Sum all skill levels for a being. */
function getTotalSkillLevels(being: Being): number {
  const s = being.skills;
  return (s.combat?.level ?? 0) + (s.defense?.level ?? 0) + (s.athletics?.level ?? 0)
    + (s.woodcutting?.level ?? 0) + (s.mining?.level ?? 0) + (s.foraging?.level ?? 0)
    + (s.building?.level ?? 0) + (s.crafting?.level ?? 0) + (s.survival?.level ?? 0)
    + (s.social?.level ?? 0);
}

/** Compute metabolism multiplier: level scaling * activity scaling. */
export function getBaseMetabolism(being: Being, beingType: 'agent' | 'animal'): number {
  const levelMod = 1 + getTotalSkillLevels(being) / 500;
  const activityMap = beingType === 'agent' ? AGENT_ACTIVITY_MULTIPLIERS : ANIMAL_ACTIVITY_MULTIPLIERS;
  const activityMod = activityMap[being.action] ?? 1.0;
  return levelMod * activityMod;
}

// ─── Per-action stamina costs (shared between agents and animals) ───

const ACTION_STAMINA_COSTS: Record<string, { base: number; skill?: string }> = {
  idle: { base: 0.02 },
  wandering: { base: 0.04, skill: 'athletics' },
  moving_to: { base: 0.05, skill: 'athletics' },
  harvesting: { base: 0.08, skill: 'woodcutting' },
  eating: { base: 0.01 },
  drinking: { base: 0.01 },
  building: { base: 0.07, skill: 'building' },
  crafting: { base: 0.05, skill: 'crafting' },
  socializing: { base: 0.02, skill: 'social' },
  trading: { base: 0.02 },
  planting: { base: 0.04, skill: 'foraging' },
  following_message: { base: 0.04 },
};

// =====================================================================
// 1. baseDecayNeeds
// =====================================================================

/**
 * Unified needs-decay logic shared by agents (decayNeeds) and animals (decayAnimalNeeds).
 *
 * Mutates `being` in place — hunger, thirst, stamina, health, age, attackCooldown.
 * Returns total environmental damage dealt this tick (for callers that award XP separately).
 *
 * Callers are responsible for:
 *  - Agent-specific fields: social, shelter, exposure damage, endurance stat bonus
 *  - Animal-specific fields: breedCooldown
 *  - Death handling (setting alive=false, action='dying')
 */
export function baseDecayNeeds(
  being: Being,
  beingType: 'agent' | 'animal',
  config: DecayConfig,
): number {
  if (!being.alive) return 0;

  const metabolism = getBaseMetabolism(being, beingType);

  // ── Hunger decay (diet-aware) ──
  const sizeMultiplier = getSizeMultiplier(config.size);
  const hungerDecay = config.hungerDecayRate * sizeMultiplier;

  let proteinDecay: number;
  let plantDecay: number;
  switch (config.diet) {
    case 'carnivore':
      proteinDecay = hungerDecay * 1.0;
      plantDecay = 0;
      break;
    case 'herbivore':
      proteinDecay = 0;
      plantDecay = hungerDecay * 1.0;
      break;
    case 'omnivore':
      proteinDecay = hungerDecay * 0.6;
      plantDecay = hungerDecay * 0.6;
      break;
  }

  being.proteinHunger = clamp(being.proteinHunger - proteinDecay * metabolism, 0, 100);
  being.plantHunger = clamp(being.plantHunger - plantDecay * metabolism, 0, 100);

  // ── Thirst decay ──
  being.thirst = clamp(being.thirst - config.thirstDecayRate * metabolism, 0, 100);

  // ── Stamina decay (per-action costs with skill reduction) ──
  const restAction = beingType === 'agent' ? 'resting' : 'sleeping';
  if (being.action === restAction) {
    const restEfficiency = 1 / (1 + getTotalSkillLevels(being) / 800);
    being.stamina = clamp(being.stamina + 0.2 * restEfficiency, 0, 100);
  } else {
    const costDef = ACTION_STAMINA_COSTS[being.action] ?? { base: config.staminaDecayRate };
    const skillReduction = costDef.skill && being.skills[costDef.skill]
      ? being.skills[costDef.skill].level * 0.002
      : 0;
    const staminaDrain = costDef.base * (1 - skillReduction) * metabolism;
    being.stamina = clamp(being.stamina - staminaDrain, 0, 100);
  }

  // ── Health damage from critical needs ──
  const dmg = config.starvationDamage ?? { both: 1.5, single: 0.5, dehydration: 0.8, exhaustion: 0.1 };
  const maxHP = config.maxHealth;

  const needsProtein = config.diet !== 'herbivore';
  const needsPlants = config.diet !== 'carnivore';
  const proteinCritical = needsProtein && being.proteinHunger <= 0;
  const plantCritical = needsPlants && being.plantHunger <= 0;

  let envDamage = 0;
  if (proteinCritical && plantCritical) {
    envDamage += dmg.both;
    being.health = clamp(being.health - dmg.both, 0, maxHP);
  } else {
    if (proteinCritical) {
      envDamage += dmg.single;
      being.health = clamp(being.health - dmg.single, 0, maxHP);
    }
    if (plantCritical) {
      envDamage += dmg.single;
      being.health = clamp(being.health - dmg.single, 0, maxHP);
    }
  }
  if (being.thirst <= 0) {
    envDamage += dmg.dehydration;
    being.health = clamp(being.health - dmg.dehydration, 0, maxHP);
  }
  if (being.stamina <= 0) {
    envDamage += dmg.exhaustion;
    being.health = clamp(being.health - dmg.exhaustion, 0, maxHP);
  }

  // ── Resting: health recovery ──
  if (being.action === restAction) {
    // Athletics bonus stamina recovery
    being.stamina = clamp(being.stamina + (being.skills.athletics?.level ?? 0) * 0.02, 0, 100);
    // Health regen while resting
    if (config.healthRegen && being.health < maxHP) {
      const age = being.age ?? 0;
      if (age % config.healthRegen.restInterval === 0) {
        const restHeal = config.healthRegen.restBase
          + (being.skills.survival?.level ?? 0) * config.healthRegen.restSkillBonus;
        being.health = clamp(being.health + restHeal, 0, maxHP);
      }
    } else if (!config.healthRegen && being.health < maxHP) {
      // Simple animal-style rest heal every 5 ticks
      const age = being.age ?? 0;
      if (age % 5 === 0) {
        const restHeal = 0.5 + (being.skills.survival?.level ?? 0) * 0.02;
        being.health = clamp(being.health + restHeal, 0, maxHP);
      }
    }
  }

  // ── Passive health regen when relevant needs are met ──
  const proteinOk = !needsProtein || being.proteinHunger > 50;
  const plantOk = !needsPlants || being.plantHunger > 50;
  if (proteinOk && plantOk && being.thirst > 50) {
    // Agents get survival-level-scaled regen; animals get flat 0.1
    if (beingType === 'agent' && being.stamina > 30) {
      const survivalRegen = 0.01 * (being.skills.survival?.level ?? 0);
      being.health = clamp(being.health + Math.max(0.05, survivalRegen), 0, maxHP);
    } else {
      being.health = clamp(being.health + 0.1, 0, maxHP);
    }
  }

  // ── Toughness passive regen (only when not taking environmental damage) ──
  if (being.health < maxHP && envDamage === 0) {
    being.health = clamp(being.health + being.baseStats.toughness * 0.002, 0, maxHP);
  }

  // ── Endurance stat: slower hunger/thirst decay ──
  const enduranceReduction = being.baseStats.endurance * 0.003;
  // Refund a fraction of decay based on endurance
  if (needsProtein) {
    being.proteinHunger = clamp(being.proteinHunger + config.hungerDecayRate * enduranceReduction, 0, 100);
  }
  if (needsPlants) {
    being.plantHunger = clamp(being.plantHunger + config.hungerDecayRate * enduranceReduction, 0, 100);
  }
  being.thirst = clamp(being.thirst + config.thirstDecayRate * enduranceReduction, 0, 100);

  // ── Survival XP from struggling ──
  const relevantNeeds: number[] = [];
  if (needsProtein) relevantNeeds.push(being.proteinHunger);
  if (needsPlants) relevantNeeds.push(being.plantHunger);
  relevantNeeds.push(being.thirst, being.stamina);
  const lowestNeed = Math.min(...relevantNeeds);
  if (lowestNeed < 30) {
    const diffMod = beingType === 'agent' ? (100 - lowestNeed) / 50 : 1.0;
    awardXP(being.skills as unknown as SkillSet, 'survival', 0.3, diffMod);
  }

  // ── Environmental damage awards survival XP (agents only — animals covered above) ──
  if (beingType === 'agent' && envDamage > 0) {
    awardXP(being.skills as unknown as SkillSet, 'survival', 0.2, envDamage);
  }

  // ── Attack cooldown ──
  if (being.attackCooldown > 0) {
    being.attackCooldown--;
  }

  return envDamage;
}

// =====================================================================
// 2. baseEvaluateThreats
// =====================================================================

/**
 * Evaluate nearby animal threats and produce flee decisions.
 *
 * Extracted from NeedsSystem.ts threat evaluation (~lines 553-641) and
 * SharedDecisionEngine.ts evaluateThreats.
 */
export function baseEvaluateThreats(
  being: Being,
  genome: BehaviorGenome,
  world: World,
  allAnimals: AnimalState[],
  _agents: unknown[],
  beingType: 'agent' | 'animal',
): Decision[] {
  const decisions: Decision[] = [];
  const isAgent = beingType === 'agent';
  const ax = Math.floor(being.x);
  const ay = Math.floor(being.y);

  for (const animal of allAnimals) {
    if (!animal.alive) continue;
    const species = getSpecies(animal.species);
    if (!species) continue;

    // Determine if this animal is a threat
    const huntsMe = isAgent
      ? (species.hunts?.includes('agent') ?? false)
      : (species.hunts?.includes((being as any).species) ?? false);

    const recentlyAttackedMe = being.lastAttackedBy?.type === 'animal'
      && being.lastAttackedBy.id === animal.id
      && ((being.age ?? 0) - being.lastAttackedBy.tick) < 50;

    const isHunting = animal.action === 'hunting' || animal.action === 'stalking';

    if (!huntsMe && !isHunting && !recentlyAttackedMe) continue;

    const dist = distance(being.x, being.y, animal.x, animal.y);

    // Perception-based detection range — wider when predator is actively hunting
    const baseDetect = genome.thresholds.threatDetectBase
      + (being.skills.survival?.level ?? 0) * 0.1;
    const detectRange = (huntsMe && isHunting) ? baseDetect * 2 : baseDetect;

    // Sound detection for large moving predators
    const sizeNum = species.size === 'large' ? 4 : species.size === 'medium' ? 3 : species.size === 'small' ? 2 : 1;
    const noise = sizeNum * (animal.action === 'hunting' ? 0.5 : 0.1);
    const soundRange = 8 * noise;

    if (dist > detectRange && dist > soundRange) continue;

    // Evaluate danger
    const myDefense = 10 + (being.skills.defense?.level ?? 0) * 0.5;
    const myAttack = being.baseStats.strength + (being.skills.combat?.level ?? 0) * 0.3;
    const equipBonus = isAgent ? (((being as any).inventory?.equipped?.mainHand ? 5 : 0) + ((being as any).inventory?.equipped?.body ? 5 : 0)) : 0;
    const totalSkills = getTotalSkillLevels(being);

    const healthFactor = being.health > 60 ? 1.0 : being.health / 60;
    const confidence = Math.min(1.5,
      (0.5 + (totalSkills / 100) + (myAttack / 20) + (equipBonus / 20)) * healthFactor);
    const dangerRatio = species.attack / Math.max(1, myDefense * confidence);

    // Confident beings ignore weak threats — but never when health is low
    if (being.health > 50 && dangerRatio < 0.4 * confidence) continue;

    const maxRange = Math.max(detectRange, soundRange);
    const proximityUrgency = 1 - (dist / maxRange);

    // Confidence reduces flee urgency
    let fleePriority = Math.floor(
      genome.interruptWeights.fleeBase
      + (dangerRatio * proximityUrgency * 35)
      - (confidence * 10),
    );

    // Desperate beings don't flee as readily
    const desperation = (being.proteinHunger < 15 || being.thirst < 15) ? 25 : 0;
    fleePriority -= desperation;

    if (recentlyAttackedMe) fleePriority = Math.min(fleePriority + 20, 98);

    if (fleePriority > 60) {
      // Smart flee: away from predator, toward resources if possible
      const awayDx = being.x - animal.x;
      const awayDy = being.y - animal.y;
      const awayLen = Math.sqrt(awayDx * awayDx + awayDy * awayDy) || 1;
      let fleeX = Math.floor(being.x + (awayDx / awayLen) * 8);
      let fleeY = Math.floor(being.y + (awayDy / awayLen) * 8);

      // Try to flee toward water if it's in the safe direction
      const water = world.findNearest(ax, ay, TileType.WATER, 15);
      if (water) {
        const toWaterDx = water.x - being.x;
        const toWaterDy = water.y - being.y;
        if (toWaterDx * awayDx + toWaterDy * awayDy > 0) {
          fleeX = water.x;
          fleeY = water.y;
        }
      }

      // Randomization to prevent stuck-in-corner loops
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

// =====================================================================
// 3. baseEvaluateSelfDefense
// =====================================================================

/**
 * Fight-back logic when being has been attacked by an animal.
 *
 * Extracted from NeedsSystem.ts (~lines 643-670).
 */
export function baseEvaluateSelfDefense(
  being: Being,
  genome: BehaviorGenome,
  world: World,
  allAnimals: AnimalState[],
): Decision[] {
  const decisions: Decision[] = [];

  if (being.lastAttackedBy?.type !== 'animal') return decisions;

  const attacker = allAnimals.find(a => a.id === being.lastAttackedBy!.id && a.alive);
  if (!attacker) return decisions;

  const distToAttacker = distance(being.x, being.y, attacker.x, attacker.y);
  if (distToAttacker >= 3) return decisions;

  const attackerSpecies = getSpecies(attacker.species);
  if (!attackerSpecies) return decisions;

  // Check for weapon bonus (agent-only field)
  let weaponBonus = 0;
  const equipped = (being as any).inventory?.equipped;
  if (equipped?.mainHand) {
    // We don't import getItemDef here to keep this module lightweight.
    // Callers that need weapon bonus can augment the decision priority.
    // For now, use a rough estimate: equipped weapon = +5.
    weaponBonus = 5;
  }

  const myAttack = 10 + (being.skills.combat?.level ?? 0) * 0.5 + weaponBonus;
  const desperate = being.health < 30 || being.proteinHunger < 15;

  // Fight back if strong enough OR if desperate (nothing to lose)
  if (desperate || myAttack > attackerSpecies.attack * genome.thresholds.fightBackMinRatio) {
    decisions.push({
      action: 'harvesting',
      priority: genome.interruptWeights.fightBack,
      target: { x: Math.floor(attacker.x), y: Math.floor(attacker.y) },
      targetId: attacker.id,
      reason: desperate ? 'fighting back (desperate)' : 'fighting back against attacker',
    });
  }

  return decisions;
}

// =====================================================================
// 4. baseEvaluateHunting
// =====================================================================

/**
 * Best-prey hunting logic — find the most attractive animal to hunt based on
 * risk/reward scoring.
 *
 * Extracted from NeedsSystem.ts (~lines 1032-1080).
 * For agents, pass `agents` to enable cannibalism check (tamedBy exclusion).
 */
export function baseEvaluateHunting(
  being: Being,
  genome: BehaviorGenome,
  world: World,
  allAnimals: AnimalState[],
  agents?: { id: string }[],
): Decision[] {
  const decisions: Decision[] = [];

  const isStarving = being.proteinHunger < 15;

  // Only hunt when hungry enough
  if (being.proteinHunger >= (genome.goalThresholds?.proteinRelevant ?? 70)) {
    return decisions;
  }

  let bestHunt: {
    priority: number;
    animal: AnimalState;
    speciesName: string;
    dist: number;
  } | null = null;

  const beingId = (being as any).id as string | undefined;

  for (const animal of allAnimals) {
    if (!animal.alive) continue;
    // Never hunt own tamed animals
    if (beingId && animal.tamedBy === beingId) continue;

    const species = getSpecies(animal.species);
    if (!species) continue;

    const dist = distance(being.x, being.y, animal.x, animal.y);
    if (dist > genome.thresholds.huntDetectRange) continue;

    const meatValue = species.drops?.meat ?? species.foodDrop ?? 0;
    if (meatValue === 0) continue;

    const myAttack = 10 + (being.skills.combat?.level ?? 0) * 0.5;
    const riskScore = species.attack / Math.max(1, myAttack);
    const rewardScore = meatValue / 10;
    const hungerUrgency = 1 - (being.proteinHunger / 100);

    // Slow prey is more attractive — agents can actually catch them
    const speedAdvantage = Math.max(0, (0.3 - species.speed) * 50);
    // Closer prey is preferred
    const distPenalty = dist * 0.5;

    // Don't hunt dangerous prey unless starving
    if (!isStarving && riskScore > 2.0 && hungerUrgency < 0.7) continue;

    const huntBase = genome.fallbackWeights?.huntAnimal ?? 40;
    let huntPriority = Math.floor(
      huntBase + (rewardScore * hungerUrgency * 25) + speedAdvantage - (riskScore * 5) - distPenalty,
    );

    // Starvation boost
    if (isStarving) {
      huntPriority = Math.max(huntPriority, 75);
    }

    if (huntPriority > 15 && (!bestHunt || huntPriority > bestHunt.priority)) {
      bestHunt = { priority: huntPriority, animal, speciesName: species.name, dist };
    }
  }

  if (bestHunt) {
    decisions.push({
      action: 'harvesting',
      priority: bestHunt.priority,
      target: { x: Math.floor(bestHunt.animal.x), y: Math.floor(bestHunt.animal.y) },
      targetId: bestHunt.animal.id,
      reason: isStarving ? `desperate hunt: ${bestHunt.speciesName}` : `hunting ${bestHunt.speciesName}`,
    });
  }

  return decisions;
}

// =====================================================================
// 5. baseEvaluateStuckEscape
// =====================================================================

/**
 * Stuck detection + obstacle breaking when a being hasn't moved for too long.
 *
 * Extracted from NeedsSystem.ts (~lines 888-956).
 *
 * @param stuckTicks — how many ticks the being has been at the same position
 * @returns A Decision to break free, or null if not stuck or can't escape
 */
export function baseEvaluateStuckEscape(
  being: Being,
  _genome: BehaviorGenome,
  world: World,
  stuckTicks: number,
): Decision | null {
  if (stuckTicks < 30) return null;

  const ax = Math.floor(being.x);
  const ay = Math.floor(being.y);

  // Check all 8 neighbors for walkability
  const dirs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 },
  ];

  const hasWalkable = dirs.some(d => world.isWalkable(ax + d.dx, ay + d.dy));
  if (hasWalkable) return null; // Not truly trapped, just re-evaluate

  // Completely trapped — break through adjacent obstacle to escape
  // Priority: trees (choppable) > rocks (mineable) > structures (breakable)
  for (const d of dirs) {
    const tx = ax + d.dx;
    const ty = ay + d.dy;
    const tile = world.getTile(tx, ty);

    if (tile === TileType.TREE) {
      const tree = world.trees.find(
        (t: any) => tx >= t.x && tx < t.x + 2 && ty >= t.y && ty < t.y + 2 && !t.isStump,
      );
      if (tree) {
        return {
          action: 'harvesting',
          priority: 99,
          target: { x: tree.x, y: tree.y },
          reason: 'trapped! chopping tree to escape',
        };
      }
    }

    if (tile === TileType.STONE) {
      const rock = world.rocks.find(
        (r: any) => r.x === tx && r.y === ty && !r.isRubble,
      );
      if (rock) {
        return {
          action: 'harvesting',
          priority: 99,
          target: { x: tx, y: ty },
          reason: 'trapped! mining rock to escape',
        };
      }
    }

    // Breakable structures
    const breakable: number[] = [
      TileType.BUILT_WALL, TileType.STONE_WALL, TileType.IRON_WALL,
      TileType.WOOD_DOOR, TileType.BONE_FENCE, TileType.ANIMAL_PEN,
    ];
    if (breakable.includes(tile as number)) {
      return {
        action: 'harvesting',
        priority: 99,
        target: { x: tx, y: ty },
        reason: 'trapped! breaking wall to escape',
      };
    }
  }

  // Trapped by water or map edge — can't escape
  return null;
}
