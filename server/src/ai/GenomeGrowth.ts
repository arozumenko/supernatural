import type { BehaviorGenome, AgentArchetype, SkillSet } from '../../shared/src/index.ts';
import { clampGenome } from './BehaviorGenome.ts';

/**
 * Growth profiles define how genome parameters scale with total skill level.
 * Each entry: [genomePath, growthPerLevel]
 * Growth is applied as: baseValue + (totalLevel * growthPerLevel)
 */
type GrowthProfile = [string, number][];

// --- Agent archetype growth profiles ---
const AGENT_GROWTH: Record<AgentArchetype, GrowthProfile> = {
  random: [
    ['fallbackWeights.huntAnimal', 0.3],
    ['fallbackWeights.gatherWood', 0.2],
    ['fallbackWeights.craft', 0.2],
    ['goalWeights.survive_thirst', 0.01],
    ['goalWeights.survive_protein', 0.01],
    ['goalWeights.survive_plant', 0.01],
  ],
  warrior: [
    ['interruptWeights.fightBack', 0.15],
    ['fallbackWeights.huntAnimal', 0.5],
    ['fallbackWeights.craft', 0.3],
    ['goalWeights.survive_protein', 0.015],
    ['thresholds.huntDetectRange', 0.1],
  ],
  survivor: [
    ['thresholds.criticalThirst', 0.2],
    ['thresholds.criticalHunger', 0.2],
    ['fallbackWeights.plantSeeds', 0.3],
    ['goalWeights.survive_thirst', 0.015],
    ['goalWeights.survive_protein', 0.01],
    ['goalWeights.survive_plant', 0.015],
  ],
  builder: [
    ['fallbackWeights.gatherWood', 0.4],
    ['fallbackWeights.mineStone', 0.3],
    ['fallbackWeights.craft', 0.4],
    ['goalWeights.get_shelter', 0.015],
    ['goalWeights.get_equipped', 0.01],
  ],
  scout: [
    ['thresholds.threatDetectBase', 0.08],
    ['thresholds.huntDetectRange', 0.15],
    ['fallbackWeights.wander', 0.2],
    ['goalWeights.survive_thirst', 0.01],
    ['goalWeights.survive_plant', 0.01],
  ],
  social: [
    ['fallbackWeights.socialize', 0.4],
    ['fallbackWeights.tameAnimal', 0.3],
    ['goalWeights.socialize', 0.02],
    ['thresholds.socialDetectRange', 0.1],
    ['goalWeights.survive_protein', 0.01],
  ],
};

// --- Animal diet-based growth profiles ---
const ANIMAL_GROWTH: Record<string, GrowthProfile> = {
  carnivore: [
    ['fallbackWeights.huntAnimal', 0.5],
    ['interruptWeights.fightBack', 0.15],
    ['goalWeights.survive_protein', 0.015],
    ['thresholds.huntDetectRange', 0.1],
  ],
  herbivore: [
    ['fallbackWeights.plantSeeds', 0.2],
    ['goalWeights.survive_plant', 0.015],
    ['thresholds.threatDetectBase', 0.1],
    ['interruptWeights.fleeBase', 0.1],
  ],
  omnivore: [
    ['fallbackWeights.huntAnimal', 0.3],
    ['goalWeights.survive_protein', 0.01],
    ['goalWeights.survive_plant', 0.01],
    ['thresholds.threatDetectBase', 0.05],
  ],
};

/**
 * Apply level-based genome growth.
 * Call periodically (e.g. every 100 ticks) — recalculates from current total level.
 * Stores the last applied level to compute delta growth.
 */
export function applyGenomeGrowth(
  genome: BehaviorGenome,
  totalLevel: number,
  profileKey: AgentArchetype | string, // archetype for agents, diet for animals
  isAnimal: boolean = false,
): void {
  const lastLevel = (genome as any)._growthAppliedLevel ?? 0;
  if (totalLevel <= lastLevel) return; // no new levels

  const levelsGained = totalLevel - lastLevel;
  const profile = isAnimal
    ? (ANIMAL_GROWTH[profileKey] ?? ANIMAL_GROWTH['omnivore'])
    : (AGENT_GROWTH[profileKey as AgentArchetype] ?? AGENT_GROWTH['random']);

  for (const [path, growthPerLevel] of profile) {
    const parts = path.split('.');
    let obj: any = genome;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]];
      if (!obj) break;
    }
    if (obj) {
      const key = parts[parts.length - 1];
      if (typeof obj[key] === 'number') {
        obj[key] += growthPerLevel * levelsGained;
      }
    }
  }

  (genome as any)._growthAppliedLevel = totalLevel;
  clampGenome(genome, totalLevel);
}

/**
 * Get total skill level from a SkillSet.
 */
export function getTotalLevel(skills: SkillSet): number {
  return Object.values(skills).reduce((sum, s) => sum + s.level, 0);
}
