import type { BehaviorGenome, DeathCause } from '../../shared/src/index.ts';
import { clampGenome } from './BehaviorGenome.ts';

/**
 * Apply rule-based mutations to the genome based on death cause.
 * Uses a tier system: repeated deaths from the same cause escalate the mutation
 * up to tier 10, with each tier applying a stronger effect.
 * Mutates genome in place, then clamps to safety bounds.
 */
export function applyFallbackMutation(genome: BehaviorGenome, deathCause: DeathCause, totalLevel: number = 0): void {
  // Track same-cause deaths for tier escalation — tiers are permanent
  if (!genome.mutationTiers) genome.mutationTiers = {};
  const causeKey = deathCause.type;
  const currentTier = Math.min(10, (genome.mutationTiers[causeKey] ?? 0) + 1);
  genome.mutationTiers[causeKey] = currentTier;

  const mutator = FALLBACK_MUTATIONS[causeKey];
  if (mutator) {
    mutator(genome, currentTier);
  }

  genome.version++;
  genome.mutatedAt = Date.now();

  // Update lineage: replace existing entry for same cause instead of appending duplicates
  const suffix = deathCause.killerSpecies ? ` by ${deathCause.killerSpecies}` : '';
  const newEntry = `fallback: ${deathCause.type} +${currentTier}${suffix}`;
  const existingIdx = genome.lineage.findIndex(l => l.startsWith(`fallback: ${deathCause.type}`));
  if (existingIdx >= 0) {
    genome.lineage[existingIdx] = newEntry;
  } else {
    genome.lineage.push(newEntry);
  }

  clampGenome(genome, totalLevel);
}

/**
 * Tier-scaled mutations. Each tier (1-10) applies a progressively stronger effect.
 * Tier 1-3: mild adaptation. Tier 4-6: moderate. Tier 7-10: aggressive restructuring.
 */
const FALLBACK_MUTATIONS: Record<DeathCause['type'], (g: BehaviorGenome, tier: number) => void> = {
  'starvation_protein': (g, tier) => {
    const t = tier;
    g.goalWeights.survive_protein = Math.min(g.goalWeights.survive_protein + t * 0.3, 8.0);
    g.fallbackWeights.huntAnimal = Math.min(g.fallbackWeights.huntAnimal + t * 2, 90);
    g.thresholds.criticalHunger = Math.min(g.thresholds.criticalHunger + t * 2, 50);
    if (t >= 4) g.thresholds.huntDetectRange = Math.min(g.thresholds.huntDetectRange + t, 40);
    if (t >= 7) g.fallbackWeights.craft = Math.min(g.fallbackWeights.craft + t, 60); // craft weapons to hunt better
  },

  'starvation_plant': (g, tier) => {
    const t = tier;
    g.goalWeights.survive_plant = Math.min(g.goalWeights.survive_plant + t * 0.3, 8.0);
    g.mediumPriorityWeights.forageMedium = Math.min(g.mediumPriorityWeights.forageMedium + t * 2, 85);
    g.fallbackWeights.plantSeeds = Math.min(g.fallbackWeights.plantSeeds + t * 3, 70); // plant more to prevent scarcity
    if (t >= 4) g.thresholds.criticalHunger = Math.min(g.thresholds.criticalHunger + t * 2, 50);
    if (t >= 7) g.fallbackWeights.huntAnimal = Math.min(g.fallbackWeights.huntAnimal + t, 70); // hunt herbivores to protect plants
  },

  'starvation_both': (g, tier) => {
    const t = tier;
    g.goalWeights.survive_protein = Math.min(g.goalWeights.survive_protein + t * 0.2, 7.0);
    g.goalWeights.survive_plant = Math.min(g.goalWeights.survive_plant + t * 0.2, 7.0);
    g.fallbackWeights.huntAnimal = Math.min(g.fallbackWeights.huntAnimal + t * 2, 85);
    g.mediumPriorityWeights.forageMedium = Math.min(g.mediumPriorityWeights.forageMedium + t * 2, 80);
    g.thresholds.criticalHunger = Math.min(g.thresholds.criticalHunger + t * 2, 50);
    if (t >= 5) g.fallbackWeights.plantSeeds = Math.min(g.fallbackWeights.plantSeeds + t * 2, 60);
  },

  'dehydration': (g, tier) => {
    const t = tier;
    g.goalWeights.survive_thirst = Math.min(g.goalWeights.survive_thirst + t * 0.3, 8.0);
    g.thresholds.criticalThirst = Math.min(g.thresholds.criticalThirst + t * 2, 50);
    g.mediumPriorityWeights.drinkMedium = Math.min(g.mediumPriorityWeights.drinkMedium + t * 2, 85);
    if (t >= 5) g.thresholds.waterDetectRange = Math.min((g.thresholds as any).waterDetectRange ?? 15 + t, 30);
  },

  'killed_by_animal': (g, tier) => {
    const t = tier;
    // Low tiers: flee better. High tiers: fight back instead
    if (t <= 4) {
      g.thresholds.threatDetectBase = Math.min(g.thresholds.threatDetectBase + t, 20);
      g.interruptWeights.fleeBase = Math.min(g.interruptWeights.fleeBase + t, 80);
    } else {
      // High tier: stop fleeing, start fighting
      g.interruptWeights.fightBack = Math.min(g.interruptWeights.fightBack + t * 2, 98);
      g.thresholds.fightBackMinRatio = Math.max(g.thresholds.fightBackMinRatio - t * 0.03, 0.2);
      g.interruptWeights.fleeBase = Math.max(g.interruptWeights.fleeBase - t, 30);
      if (t >= 8) g.fallbackWeights.craft = Math.min(g.fallbackWeights.craft + t, 60); // craft weapons
    }
  },

  'killed_by_agent': (g, tier) => {
    const t = tier;
    if (t <= 3) {
      g.thresholds.groupDefenseRange = Math.min(g.thresholds.groupDefenseRange + t, 20);
      g.interruptWeights.fleeBase = Math.min(g.interruptWeights.fleeBase + t, 75);
    } else {
      // High tier: become aggressive defender
      g.interruptWeights.fightBack = Math.min(g.interruptWeights.fightBack + t * 2, 98);
      g.thresholds.fightBackMinRatio = Math.max(g.thresholds.fightBackMinRatio - t * 0.04, 0.15);
      if (t >= 7) g.fallbackWeights.craft = Math.min(g.fallbackWeights.craft + t, 60);
    }
  },

  'exhaustion': (g, tier) => {
    const t = tier;
    g.goalWeights.rest = Math.min(g.goalWeights.rest + t * 0.3, 8.0);
    g.thresholds.criticalStamina = Math.min(g.thresholds.criticalStamina + t * 2, 40);
    if (t >= 3) g.mediumPriorityWeights.eatMedium = Math.min(g.mediumPriorityWeights.eatMedium + t, 75); // eat to restore stamina
    if (t >= 5) g.fallbackWeights.wander = Math.max(g.fallbackWeights.wander - t, 5); // wander less
    if (t >= 7) {
      // Aggressive rest: reduce all non-survival activity weights
      g.fallbackWeights.craft = Math.max(g.fallbackWeights.craft - 3, 10);
      g.fallbackWeights.plantSeeds = Math.max(g.fallbackWeights.plantSeeds - 2, 10);
    }
  },

  'poison': (g, tier) => {
    const t = tier;
    // Learn to avoid poison, prefer hunting over foraging
    g.fallbackWeights.huntAnimal = Math.min(g.fallbackWeights.huntAnimal + t * 2, 80);
    if (t >= 3) g.goalWeights.survive_plant = Math.max(g.goalWeights.survive_plant - t * 0.1, 0.5);
    if (t >= 5) g.fallbackWeights.craft = Math.min(g.fallbackWeights.craft + t, 50); // cook food instead
  },
};
