import type { AgentState, LifeJournal } from '../../shared/src/index.ts';

/**
 * Calculate lives change on death.
 * Returns a signed integer (usually negative: base -1 + bonuses).
 */
export function calculateLivesChange(journal: LifeJournal, agent: AgentState): number {
  let change = -1; // base death cost

  // Skill level bonus: +1 per 10 total skill levels gained THIS life
  const currentTotal = sumSkillLevels(agent);
  const birthTotal = Object.values(journal.birthSkills).reduce((a, b) => a + b, 0);
  const levelsGained = currentTotal - birthTotal;
  change += Math.floor(levelsGained / 10);

  // Survival milestone bonuses (largest applicable only)
  if (journal.survivalTicks >= 50000) change += 25;
  else if (journal.survivalTicks >= 10000) change += 10;
  else if (journal.survivalTicks >= 1000) change += 5;

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

  // Check iron tool
  const hasIronTool = agent.inventory.items.some(i =>
    i.itemId.startsWith('iron_') || i.itemId === 'iron_axe' || i.itemId === 'iron_pickaxe'
  );
  if (hasIronTool) award('first_iron_tool', 10);

  // Taming (check if any animal is tamed by this agent — tracked via metric)
  const metricsAccum = (agent as any)._metricsAccum;
  if (metricsAccum?.animalsTamed > 0) award('first_tame', 5);

  // Social leader
  if (agent.socialScore > 50) award('social_leader', 10);

  // Master crafter
  if (agent.skills.crafting.level >= 50) award('master_crafter', 15);

  // Killed apex predator
  if (metricsAccum?.animalsKilledBySpecies) {
    const apexSpecies = ['bear', 'tiger', 'alligator'];
    for (const apex of apexSpecies) {
      if ((metricsAccum.animalsKilledBySpecies[apex] ?? 0) > 0) {
        award('killed_apex', 5);
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
