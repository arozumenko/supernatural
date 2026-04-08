import type { AgentState, LifeJournal } from '../../shared/src/index.ts';

/**
 * Calculate lives change on death.
 * Returns a signed integer (usually negative: base -1 + bonuses).
 */
export function calculateLivesChange(journal: LifeJournal, agent: AgentState): number {
  let change = -1; // base death cost

  // Survival bonus: long lives earn back the death cost (but never profit)
  // Need 3000+ ticks (~5 min) just to break even
  if (journal.survivalTicks >= 6000) change += 1;      // 10+ min: net 0
  else if (journal.survivalTicks >= 3000) change += 1;  // 5+ min: net 0

  // Achievement bonuses (one-time per agent lifetime)
  const achievements = agent.achievements ?? [];
  change += checkAchievements(agent, achievements);

  return change;
}

/**
 * Check for new one-time achievements and award lives.
 * Mutates agent.achievements in place.
 */
function checkAchievements(agent: AgentState, achievements: string[]): number {
  let bonus = 0;

  const has = (id: string) => achievements.includes(id);
  const award = (id: string, lives: number) => {
    if (!has(id)) {
      achievements.push(id);
      bonus += lives;
    }
  };

  // Killed apex predator
  const metricsAccum = (agent as any)._metricsAccum;
  if (metricsAccum?.animalsKilledBySpecies) {
    const apexSpecies = ['bear', 'tiger', 'alligator'];
    for (const apex of apexSpecies) {
      if ((metricsAccum.animalsKilledBySpecies[apex] ?? 0) > 0) {
        award('killed_apex', 3);
        break;
      }
    }
  }

  return bonus;
}

/**
 * Check if agent qualifies for Highlander status.
 */
export function checkHighlander(agent: AgentState): boolean {
  const totalLevels = sumSkillLevels(agent);
  const bestSurvival = agent.lifetimeBestSurvival ?? 0;
  // Highlander: 500+ total skill levels AND 100000+ tick survival
  return totalLevels >= 500 && bestSurvival >= 100000;
}

function sumSkillLevels(agent: AgentState): number {
  return Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
}
