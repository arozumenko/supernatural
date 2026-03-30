import type { BehaviorGenome } from '../../shared/src/index.ts';
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
      fleeBase: 70,
    },

    mediumPriorityWeights: {
      drinkMedium: 60,
      eatMedium: 55,
      forageMedium: 55,
    },

    thresholds: {
      criticalThirst: 20,
      criticalHunger: 20,
      criticalStamina: 15,
      criticalHealth: 30,
      moderateHealth: 60,
      fleeHealthPanic: 0.3,
      fightBackMinRatio: 0.5,
      groupDefenseRange: 8,

      meatMinimum: 3,
      woodMinimum: 10,
      stoneMinimum: 5,
      ironOreMinimum: 4,

      plantHungerTrigger: 60,
      woodToKeepBeforePlanting: 5,

      threatDetectBase: 6,
      huntDetectRange: 15,
      socialDetectRange: 15,
      corpseDetectRange: 15,
      ironDetectRange: 20,
    },

    goalWeights: {
      survive_thirst: 1.0,
      survive_protein: 1.0,
      survive_plant: 1.0,
      rest: 1.0,
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
export function clampGenome(genome: BehaviorGenome): void {
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
}
