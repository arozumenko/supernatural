import type { BehaviorGenome, CreatureGenome, AnimalSpecies } from '../../shared/src/index.ts';
import { GENOME_BOUNDS } from '../../shared/src/index.ts';

/**
 * Creates the default genome with all values matching the current hardcoded
 * priorities/thresholds in NeedsSystem.ts and GOAPPlanner.ts.
 * First life plays identically to the pre-genome system.
 */
export function createDefaultGenome(tick: number = 0): BehaviorGenome {
  return {
    version: 1,
    generation: 0,
    lineage: [],

    interruptWeights: {
      criticalThirst: 95,
      fightBack: 93,
      criticalHunger: 90,
      lowHealth: 88,
      staminaHerb: 82,
      exhaustionRest: 80,
      groupDefense: 75,
      fleeBase: 55,         // was 75 — armed/skilled agents should stand and fight more often
    },

    mediumPriorityWeights: {
      drinkMedium: 63,      // was 60 — drink proactively
      eatMedium: 58,        // was 55 — eat proactively
      forageMedium: 58,     // was 55
    },

    thresholds: {
      criticalThirst: 30,      // was 20 — drink sooner
      criticalHunger: 30,      // was 20 — eat sooner
      criticalStamina: 20,     // was 15 — rest sooner
      criticalHealth: 40,      // was 30 — heal sooner
      moderateHealth: 60,
      fleeHealthPanic: 0.4,    // was 0.3 — flee at 40% HP not 30%
      fightBackMinRatio: 0.6,  // was 0.5 — only fight if stronger
      groupDefenseRange: 8,

      meatMinimum: 3,
      woodMinimum: 10,
      stoneMinimum: 5,
      ironOreMinimum: 4,

      foodTarget: 6,
      woodTarget: 10,
      stoneTarget: 5,
      stockpileUrgent: 50,

      plantHungerTrigger: 60,
      woodToKeepBeforePlanting: 5,

      threatDetectBase: 3,      // base 3 tiles, doubles to 6 when predator hunting
      huntDetectRange: 15,
      socialDetectRange: 15,
      corpseDetectRange: 15,
      ironDetectRange: 20,
    },

    goalWeights: {
      survive_thirst: 1.3,    // was 1.0 — prioritize hydration
      survive_protein: 1.2,   // was 1.0 — prioritize food
      survive_plant: 1.2,     // was 1.0
      rest: 1.1,              // was 1.0 — rest more to avoid exhaustion
      get_shelter: 1.0,
      get_equipped: 1.0,
      socialize: 1.0,
      stockpile_wood: 1.0,
      stockpile_stone: 1.0,
      cook_food: 1.0,
    },

    actionCostMods: {},

    goalThresholds: {
      thirstRelevant: 50,
      proteinRelevant: 50,
      plantRelevant: 50,
      staminaRelevant: 30,
      shelterRelevant: 40,
      socialRelevant: 40,
      woodTarget: 15,
      stoneTarget: 8,
    },

    fallbackWeights: {
      drinkMedium: 60,
      eatMedium: 55,
      harvestCorpse: 50,
      gatherWood: 35,
      mineStone: 30,
      huntAnimal: 40,
      socialize: 30,
      mineIron: 28,
      craft: 25,
      tameAnimal: 20,
      plantSeeds: 20,
      wander: 10,
    },

    strategyRules: [],

    createdAt: tick,
    mutatedAt: tick,
    fitnessScore: 50,
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateGenome(genome: BehaviorGenome): ValidationResult {
  const errors: string[] = [];
  const B = GENOME_BOUNDS;

  // Interrupt weights
  for (const [key, val] of Object.entries(genome.interruptWeights)) {
    if (val < B.interruptWeights.min || val > B.interruptWeights.max) {
      errors.push(`interruptWeights.${key} out of bounds: ${val}`);
    }
  }

  // Medium priority weights
  for (const [key, val] of Object.entries(genome.mediumPriorityWeights)) {
    if (val < B.mediumPriorityWeights.min || val > B.mediumPriorityWeights.max) {
      errors.push(`mediumPriorityWeights.${key} out of bounds: ${val}`);
    }
  }

  // Thresholds — needs
  const needKeys = ['criticalThirst', 'criticalHunger', 'criticalStamina', 'criticalHealth', 'moderateHealth', 'plantHungerTrigger'] as const;
  for (const key of needKeys) {
    const val = genome.thresholds[key];
    if (val < B.thresholds.needs.min || val > B.thresholds.needs.max) {
      errors.push(`thresholds.${key} out of bounds: ${val}`);
    }
  }

  // Thresholds — resources
  const resourceKeys = ['meatMinimum', 'woodMinimum', 'stoneMinimum', 'ironOreMinimum', 'woodToKeepBeforePlanting'] as const;
  for (const key of resourceKeys) {
    const val = genome.thresholds[key];
    if (val < B.thresholds.resources.min || val > B.thresholds.resources.max) {
      errors.push(`thresholds.${key} out of bounds: ${val}`);
    }
  }

  // Thresholds — detection ranges
  const detectKeys = ['threatDetectBase', 'huntDetectRange', 'socialDetectRange', 'corpseDetectRange', 'ironDetectRange'] as const;
  for (const key of detectKeys) {
    const val = genome.thresholds[key];
    if (val < B.thresholds.detection.min || val > B.thresholds.detection.max) {
      errors.push(`thresholds.${key} out of bounds: ${val}`);
    }
  }

  // flee/fight ratios
  if (genome.thresholds.fleeHealthPanic < B.thresholds.fleeHealthPanic.min ||
      genome.thresholds.fleeHealthPanic > B.thresholds.fleeHealthPanic.max) {
    errors.push(`thresholds.fleeHealthPanic out of bounds: ${genome.thresholds.fleeHealthPanic}`);
  }
  if (genome.thresholds.fightBackMinRatio < B.thresholds.fightBackMinRatio.min ||
      genome.thresholds.fightBackMinRatio > B.thresholds.fightBackMinRatio.max) {
    errors.push(`thresholds.fightBackMinRatio out of bounds: ${genome.thresholds.fightBackMinRatio}`);
  }

  // Goal thresholds (when GOAP/fallback goals activate)
  if (genome.goalThresholds) {
    for (const [key, val] of Object.entries(genome.goalThresholds)) {
      if (typeof val === 'number' && (val < B.thresholds.goalThresholds.min || val > B.thresholds.goalThresholds.max)) {
        errors.push(`goalThresholds.${key} out of bounds: ${val}`);
      }
    }
  }

  // Goal weights
  for (const [key, val] of Object.entries(genome.goalWeights)) {
    if (val < B.goalWeights.min || val > B.goalWeights.max) {
      errors.push(`goalWeights.${key} out of bounds: ${val}`);
    }
  }

  // Survival goals can't be suppressed
  const survivalGoals = ['survive_thirst', 'survive_protein', 'survive_plant'] as const;
  for (const g of survivalGoals) {
    if ((genome.goalWeights[g] ?? 1.0) < B.survivalGoalMinWeight) {
      errors.push(`Survival goal ${g} weight too low: ${genome.goalWeights[g]}`);
    }
  }

  // Action cost mods
  for (const [key, val] of Object.entries(genome.actionCostMods)) {
    if (val < B.actionCostMods.min || val > B.actionCostMods.max) {
      errors.push(`actionCostMods.${key} out of bounds: ${val}`);
    }
  }

  // Fallback weights
  for (const [key, val] of Object.entries(genome.fallbackWeights)) {
    if (val < B.fallbackWeights.min || val > B.fallbackWeights.max) {
      errors.push(`fallbackWeights.${key} out of bounds: ${val}`);
    }
  }

  // Strategy rules
  if (genome.strategyRules.length > B.strategyRules.maxCount) {
    errors.push(`Too many strategy rules: ${genome.strategyRules.length}`);
  }
  for (const rule of genome.strategyRules) {
    if (rule.priority < B.rulePriority.min || rule.priority > B.rulePriority.max) {
      errors.push(`Rule ${rule.id} priority out of bounds: ${rule.priority}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Clamp all genome values to safety bounds (mutates in place) */
export function clampGenome(genome: BehaviorGenome, totalLevel: number = 0): void {
  const B = GENOME_BOUNDS;
  const c = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  for (const key of Object.keys(genome.interruptWeights) as (keyof typeof genome.interruptWeights)[]) {
    genome.interruptWeights[key] = c(genome.interruptWeights[key], B.interruptWeights.min, B.interruptWeights.max);
  }
  for (const key of Object.keys(genome.mediumPriorityWeights) as (keyof typeof genome.mediumPriorityWeights)[]) {
    genome.mediumPriorityWeights[key] = c(genome.mediumPriorityWeights[key], B.mediumPriorityWeights.min, B.mediumPriorityWeights.max);
  }
  for (const key of Object.keys(genome.fallbackWeights) as (keyof typeof genome.fallbackWeights)[]) {
    genome.fallbackWeights[key] = c(genome.fallbackWeights[key], B.fallbackWeights.min, B.fallbackWeights.max);
  }
  for (const key of Object.keys(genome.goalWeights)) {
    genome.goalWeights[key] = c(genome.goalWeights[key], B.goalWeights.min, B.goalWeights.max);
  }
  for (const key of Object.keys(genome.actionCostMods)) {
    genome.actionCostMods[key] = c(genome.actionCostMods[key], B.actionCostMods.min, B.actionCostMods.max);
  }
  // Clamp goal thresholds
  if (genome.goalThresholds) {
    for (const key of Object.keys(genome.goalThresholds) as (keyof typeof genome.goalThresholds)[]) {
      genome.goalThresholds[key] = c(genome.goalThresholds[key], B.thresholds.goalThresholds.min, B.thresholds.goalThresholds.max);
    }
  }

  // Survival goals min
  for (const g of ['survive_thirst', 'survive_protein', 'survive_plant']) {
    if (genome.goalWeights[g] !== undefined && genome.goalWeights[g] < B.survivalGoalMinWeight) {
      genome.goalWeights[g] = B.survivalGoalMinWeight;
    }
  }

  // Clamp strategy rule count
  if (genome.strategyRules.length > B.strategyRules.maxCount) {
    genome.strategyRules.length = B.strategyRules.maxCount;
  }

  // --- Group budget enforcement ---
  // Mutation floors (from mutationTiers) are respected; excess trimmed proportionally.
  // Budget grows +1% per total skill level (e.g. level 50 = +50% budget headroom)
  const levelScale = 1 + totalLevel * 0.01;
  const baseBudgets = B.groupBudgets;
  const floors = genome.mutationTiers ? getMutationFloors(genome) : {};

  enforceGroupBudget(genome.interruptWeights, baseBudgets.interruptWeights * levelScale, B.interruptWeights.min, floors.interruptWeights);
  enforceGroupBudget(genome.mediumPriorityWeights, baseBudgets.mediumPriorityWeights * levelScale, B.mediumPriorityWeights.min, floors.mediumPriorityWeights);
  enforceGroupBudget(genome.goalWeights, baseBudgets.goalWeights * levelScale, B.goalWeights.min, floors.goalWeights);
  enforceGroupBudget(genome.fallbackWeights, baseBudgets.fallbackWeights * levelScale, B.fallbackWeights.min, floors.fallbackWeights);
}

/**
 * Enforce a total budget on a group of parameters.
 * Each parameter has a floor (from mutations or group min). Values above floors
 * are trimmed proportionally if the total exceeds the budget.
 */
function enforceGroupBudget(
  group: Record<string, number>,
  budget: number,
  groupMin: number,
  paramFloors?: Record<string, number>
): void {
  const keys = Object.keys(group);
  const total = keys.reduce((sum, k) => sum + group[k], 0);
  if (total <= budget) return;

  // Calculate each parameter's floor (mutation floor or group min)
  const floorSum = keys.reduce((sum, k) => sum + Math.max(groupMin, paramFloors?.[k] ?? groupMin), 0);
  if (floorSum >= budget) return; // floors alone exceed budget — can't trim further

  // Trim excess proportionally from values above their floors
  const excess = total - budget;
  const aboveFloor: { key: string; surplus: number }[] = [];
  let totalSurplus = 0;
  for (const k of keys) {
    const floor = Math.max(groupMin, paramFloors?.[k] ?? groupMin);
    const surplus = group[k] - floor;
    if (surplus > 0) {
      aboveFloor.push({ key: k, surplus });
      totalSurplus += surplus;
    }
  }
  if (totalSurplus <= 0) return;

  for (const { key, surplus } of aboveFloor) {
    const trimAmount = (surplus / totalSurplus) * excess;
    const floor = Math.max(groupMin, paramFloors?.[key] ?? groupMin);
    group[key] = Math.max(floor, group[key] - trimAmount);
  }
}

/**
 * Derive per-parameter mutation floors from mutation tiers.
 * These represent the minimum values earned through evolution that can't be taken away.
 */
function getMutationFloors(genome: BehaviorGenome): Record<string, Record<string, number>> {
  const tiers = genome.mutationTiers ?? {};
  const floors: Record<string, Record<string, number>> = {
    interruptWeights: {},
    mediumPriorityWeights: {},
    goalWeights: {},
    fallbackWeights: {},
  };

  // starvation_protein mutations set floors on hunt-related params
  const sp = tiers['starvation_protein'] ?? 0;
  if (sp > 0) {
    floors.fallbackWeights['huntAnimal'] = 40 + sp * 2;
    floors.goalWeights['survive_protein'] = 1.2 + sp * 0.3;
  }

  // starvation_plant mutations set floors on forage/plant params
  const spl = tiers['starvation_plant'] ?? 0;
  if (spl > 0) {
    floors.mediumPriorityWeights['forageMedium'] = 58 + spl * 2;
    floors.fallbackWeights['plantSeeds'] = 20 + spl * 3;
    floors.goalWeights['survive_plant'] = 1.2 + spl * 0.3;
  }

  // starvation_both
  const sb = tiers['starvation_both'] ?? 0;
  if (sb > 0) {
    floors.fallbackWeights['huntAnimal'] = Math.max(floors.fallbackWeights['huntAnimal'] ?? 0, 40 + sb * 2);
    floors.mediumPriorityWeights['forageMedium'] = Math.max(floors.mediumPriorityWeights['forageMedium'] ?? 0, 58 + sb * 2);
  }

  // dehydration
  const dh = tiers['dehydration'] ?? 0;
  if (dh > 0) {
    floors.mediumPriorityWeights['drinkMedium'] = 63 + dh * 2;
    floors.goalWeights['survive_thirst'] = 1.3 + dh * 0.3;
  }

  // exhaustion
  const ex = tiers['exhaustion'] ?? 0;
  if (ex > 0) {
    floors.goalWeights['rest'] = 1.1 + ex * 0.3;
    floors.interruptWeights['exhaustionRest'] = 80 + ex * 1;
  }

  // killed_by_animal — high tiers set fight-back floors
  const ka = tiers['killed_by_animal'] ?? 0;
  if (ka >= 5) {
    floors.interruptWeights['fightBack'] = 93 + (ka - 4) * 2;
  }

  // killed_by_agent — high tiers set fight-back floors
  const kag = tiers['killed_by_agent'] ?? 0;
  if (kag >= 4) {
    floors.interruptWeights['fightBack'] = Math.max(floors.interruptWeights['fightBack'] ?? 0, 93 + (kag - 3) * 2);
  }

  return floors;
}

/**
 * Create a genome for an animal based on its species config.
 * Maps species utility weights → genome priority weights.
 */
export function createAnimalGenome(species: AnimalSpecies, tick: number = 0): CreatureGenome {
  const c = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));
  const uw = species.utilityWeights;

  // Map utility floats to integer priorities
  const fleeBase = c(60 + uw.safety * 25, 60, 99);           // safety 0→60, 2.0→99
  const huntWeight = c(10 + uw.aggression * 40, 5, 70);      // aggression 0→10, 1.5→70
  const eatWeight = c(30 + uw.food * 25, 5, 70);             // food 0→30, 1.5→68
  const drinkWeight = c(35 + uw.water * 25, 5, 70);          // water 0→35, 1.0→60

  return {
    creatureType: 'animal',
    species: species.id,
    diet: species.diet,
    size: species.size,

    version: 1,
    generation: 0,
    lineage: [`species: ${species.id}`],

    interruptWeights: {
      criticalThirst: 95,
      fightBack: uw.aggression > 0.5 ? c(80 + uw.aggression * 10, 60, 99) : 70,
      criticalHunger: 90,
      lowHealth: 85,
      staminaHerb: 75,
      exhaustionRest: 78,
      groupDefense: 72,
      fleeBase,
    },

    mediumPriorityWeights: {
      drinkMedium: c(drinkWeight + 5, 40, 70),
      eatMedium: c(eatWeight + 3, 40, 70),
      forageMedium: c(eatWeight, 40, 70),
    },

    thresholds: {
      criticalThirst: 20,
      criticalHunger: 20,
      criticalStamina: 15,
      criticalHealth: 30,
      moderateHealth: 60,
      fleeHealthPanic: species.fleeThreshold,
      fightBackMinRatio: uw.aggression > 0.8 ? 0.3 : 0.7,
      groupDefenseRange: 6,

      meatMinimum: 0,
      woodMinimum: 0,
      stoneMinimum: 0,
      ironOreMinimum: 0,

      foodTarget: 0,
      woodTarget: 0,
      stoneTarget: 0,
      stockpileUrgent: 0,

      plantHungerTrigger: 50,
      woodToKeepBeforePlanting: 0,

      threatDetectBase: Math.round(species.detectionRange / 2),
      huntDetectRange: species.detectionRange,
      socialDetectRange: Math.round(species.detectionRange * 0.8),
      corpseDetectRange: species.detectionRange,
      ironDetectRange: 0,
    },

    goalWeights: {
      survive_thirst: 1.5,
      survive_protein: species.diet !== 'herbivore' ? 1.3 : 0.1,
      survive_plant: species.diet !== 'carnivore' ? 1.3 : 0.1,
      rest: 1.0,
      get_shelter: 0.1,
      get_equipped: 0.1,
      socialize: 0.1,
      stockpile_wood: 0.1,
      stockpile_stone: 0.1,
      cook_food: 0.1,
    },

    actionCostMods: {},

    goalThresholds: {
      thirstRelevant: 50,
      proteinRelevant: 50,
      plantRelevant: 50,
      staminaRelevant: 30,
      shelterRelevant: 20,
      socialRelevant: 20,
      woodTarget: 20,
      stoneTarget: 20,
    },

    fallbackWeights: {
      drinkMedium: drinkWeight,
      eatMedium: eatWeight,
      harvestCorpse: c(uw.aggression * 35, 5, 55),
      gatherWood: 5,
      mineStone: 5,
      huntAnimal: huntWeight,
      socialize: 5,
      mineIron: 5,
      craft: 5,
      tameAnimal: 5,
      plantSeeds: 5,
      wander: 12,
    },

    strategyRules: [],

    createdAt: tick,
    mutatedAt: tick,
    fitnessScore: 50,
  };
}

/**
 * Create an offspring genome from a parent genome with small random mutations.
 * Used for animal breeding — gentle perturbation, not death-driven evolution.
 */
export function mutateGenomeBreeding(parent: CreatureGenome): CreatureGenome {
  const offspring = structuredClone(parent);
  offspring.version = parent.version + 1;
  offspring.generation = parent.generation + 1;
  offspring.lineage = [...parent.lineage.slice(-5), 'breeding'];

  // Perturb 3-5 random weights by ±5-10%
  const mutationCount = 3 + Math.floor(Math.random() * 3);
  const targets = [
    { obj: offspring.interruptWeights, keys: Object.keys(offspring.interruptWeights), min: 60, max: 99 },
    { obj: offspring.fallbackWeights, keys: Object.keys(offspring.fallbackWeights), min: 5, max: 70 },
    { obj: offspring.mediumPriorityWeights, keys: Object.keys(offspring.mediumPriorityWeights), min: 40, max: 70 },
  ];

  for (let i = 0; i < mutationCount; i++) {
    const group = targets[Math.floor(Math.random() * targets.length)];
    const key = group.keys[Math.floor(Math.random() * group.keys.length)];
    const current = (group.obj as any)[key] as number;
    const delta = current * (Math.random() * 0.1 - 0.05); // ±5%
    (group.obj as any)[key] = Math.max(group.min, Math.min(group.max, Math.round(current + delta)));
  }

  // Small chance to perturb a threshold
  if (Math.random() < 0.3) {
    const threshKeys = ['criticalThirst', 'criticalHunger', 'fleeHealthPanic', 'fightBackMinRatio'] as const;
    const tk = threshKeys[Math.floor(Math.random() * threshKeys.length)];
    const val = offspring.thresholds[tk];
    const delta = typeof val === 'number' ? val * (Math.random() * 0.1 - 0.05) : 0;
    (offspring.thresholds as any)[tk] = Math.max(0.1, val + delta);
  }

  offspring.mutatedAt = Date.now();
  return offspring;
}
