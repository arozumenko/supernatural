import type { BehaviorGenome, DeathCause } from '../../shared/src/index.ts';
import { clampGenome } from './BehaviorGenome.ts';

/**
 * Apply rule-based mutations to the genome based on death cause.
 * Used when no LLM is assigned or LLM call fails.
 * Mutates genome in place, then clamps to safety bounds.
 */
export function applyFallbackMutation(genome: BehaviorGenome, deathCause: DeathCause): void {
  const mutator = FALLBACK_MUTATIONS[deathCause.type];
  if (mutator) {
    mutator(genome);
  }

  genome.version++;
  genome.mutatedAt = Date.now();
  genome.lineage.push(`fallback: ${deathCause.type}${deathCause.killerSpecies ? ' by ' + deathCause.killerSpecies : ''}`);

  // Keep lineage bounded
  if (genome.lineage.length > 50) {
    genome.lineage = genome.lineage.slice(-50);
  }

  clampGenome(genome);
}

const FALLBACK_MUTATIONS: Record<DeathCause['type'], (g: BehaviorGenome) => void> = {
  'starvation_protein': (g) => {
    g.goalWeights.survive_protein = Math.min(g.goalWeights.survive_protein * 1.3, 5.0);
    g.fallbackWeights.huntAnimal = Math.min(g.fallbackWeights.huntAnimal + 5, 70);
    g.thresholds.criticalHunger = Math.min(g.thresholds.criticalHunger + 5, 40);
  },

  'starvation_plant': (g) => {
    g.goalWeights.survive_plant = Math.min(g.goalWeights.survive_plant * 1.3, 5.0);
    g.fallbackWeights.eatMedium = Math.min(g.fallbackWeights.eatMedium + 5, 70);
    g.mediumPriorityWeights.forageMedium = Math.min(g.mediumPriorityWeights.forageMedium + 3, 70);
  },

  'starvation_both': (g) => {
    g.goalWeights.survive_protein = Math.min(g.goalWeights.survive_protein * 1.2, 5.0);
    g.goalWeights.survive_plant = Math.min(g.goalWeights.survive_plant * 1.2, 5.0);
    g.fallbackWeights.huntAnimal = Math.min(g.fallbackWeights.huntAnimal + 3, 70);
    g.fallbackWeights.eatMedium = Math.min(g.fallbackWeights.eatMedium + 3, 70);
    g.thresholds.criticalHunger = Math.min(g.thresholds.criticalHunger + 5, 40);
  },

  'dehydration': (g) => {
    g.goalWeights.survive_thirst = Math.min(g.goalWeights.survive_thirst * 1.3, 5.0);
    g.thresholds.criticalThirst = Math.min(g.thresholds.criticalThirst + 5, 40);
    g.mediumPriorityWeights.drinkMedium = Math.min(g.mediumPriorityWeights.drinkMedium + 5, 70);
  },

  'killed_by_animal': (g) => {
    g.interruptWeights.fleeBase = Math.min(g.interruptWeights.fleeBase + 3, 95);
    g.thresholds.fleeHealthPanic = Math.min(g.thresholds.fleeHealthPanic + 0.1, 0.8);
    g.thresholds.threatDetectBase = Math.min(g.thresholds.threatDetectBase + 1, 15);
  },

  'killed_by_agent': (g) => {
    g.interruptWeights.fleeBase = Math.min(g.interruptWeights.fleeBase + 2, 90);
    g.thresholds.groupDefenseRange = Math.min(g.thresholds.groupDefenseRange + 2, 15);
  },

  'exhaustion': (g) => {
    g.goalWeights.rest = Math.min(g.goalWeights.rest * 1.2, 5.0);
    g.thresholds.criticalStamina = Math.min(g.thresholds.criticalStamina + 3, 30);
  },

  'poison': (g) => {
    g.fallbackWeights.eatMedium = Math.max(g.fallbackWeights.eatMedium - 3, 5);
    g.goalWeights.survive_plant = Math.max(g.goalWeights.survive_plant * 0.9, 0.3);
    g.fallbackWeights.huntAnimal = Math.min(g.fallbackWeights.huntAnimal + 5, 70);
  },
};
