import type { AgentState, BehaviorGenome, LifeJournal, DeathCause, AgentNeeds, LifeMetrics } from '../../shared/src/index.ts';

export function buildEvolutionPrompt(
  agent: AgentState,
  currentGenome: BehaviorGenome,
  journal: LifeJournal,
  recentJournals: LifeJournal[]
): string {
  return `
You are the evolution engine for an AI agent in a survival simulation.

## Agent Profile
Name: ${agent.name}
Personality: ${agent.personality.join(', ')}
Lives remaining: ${agent.livesRemaining ?? 100} / started with 100
Genome version: ${currentGenome.version}
Total deaths: ${agent.totalDeaths}

## This Life (#${journal.lifeNumber})
Survived: ${journal.survivalTicks} ticks (${(journal.survivalTicks / 10).toFixed(0)} seconds)
Death cause: ${formatDeathCause(journal.deathCause)}
Location of death: (${journal.deathCause.location.x}, ${journal.deathCause.location.y})
Last 10 actions before death: ${journal.deathCause.lastActions.join(' → ')}

## Needs at Death
${formatNeeds(journal.finalNeeds)}

## Performance Metrics
${formatMetrics(journal.metrics)}

## Key Events This Life
${formatEvents(journal.events)}

## Death Pattern Analysis (last ${recentJournals.length} lives)
${formatDeathHistory(recentJournals)}

## Current Behavior Genome
${JSON.stringify(currentGenome, null, 2)}

## Spatial Analysis
Agent spent most time near: ${formatHeatmap(journal.heatmap)}
Death occurred at: (${journal.deathCause.location.x}, ${journal.deathCause.location.y})

## Your Task
Analyze why this agent died and modify the Behavior Genome to prevent similar deaths.
You may:
- Adjust any weight, threshold, or priority within the safety bounds
- Add new StrategyRules (max 15 total)
- Disable or modify existing StrategyRules
- Completely restructure priorities if the current approach is failing

Consider:
1. Is this a recurring death pattern? (check last lives)
2. Was the agent ignoring a critical need?
3. Was the agent being too aggressive or too passive?
4. Are there environmental dangers it should learn to avoid?
5. With ${agent.livesRemaining ?? 100} lives left, how cautious should it be?

IMPORTANT: The agent has ${agent.livesRemaining ?? 100} lives left. If lives are low (<20), prioritize survival over everything. If lives are high (>70), it can afford to take risks to learn.

## Safety Bounds
- Interrupt weights: [60, 99], GROUP BUDGET: sum ≤ 790
- Medium priority weights: [40, 70], GROUP BUDGET: sum ≤ 210
- Need thresholds: [5, 95]
- Resource minimums: [0, 50]
- Detection ranges: [3, 30]
- Goal weights: [0.1, 5.0] (survival goals min 0.3), GROUP BUDGET: sum ≤ 14.0
- Action cost mods: [0.2, 5.0]
- Fallback weights: [5, 70], GROUP BUDGET: sum ≤ 500
- Max 15 strategy rules, priority [1, 99]

IMPORTANT: You cannot max all parameters. Each group has a total budget — you must SPECIALIZE. Raising one parameter means lowering others. Mutation-earned floors cannot be reduced.

Respond with ONLY the updated BehaviorGenome as valid JSON. No explanation needed.
`.trim();
}

function formatDeathCause(cause: DeathCause): string {
  switch (cause.type) {
    case 'starvation_protein': return 'Starved (no protein/meat)';
    case 'starvation_plant': return 'Starved (no plant food)';
    case 'starvation_both': return 'Starved (both protein and plant hunger)';
    case 'dehydration': return 'Died of thirst';
    case 'killed_by_animal': return `Killed by ${cause.killerSpecies ?? 'unknown animal'}`;
    case 'killed_by_agent': return `Killed by agent ${cause.killerAgent ?? 'unknown'}`;
    case 'exhaustion': return 'Exhaustion';
    case 'poison': return 'Poisoned (ate toxic mushroom)';
    default: return cause.type;
  }
}

function formatNeeds(needs: AgentNeeds): string {
  if (!needs) return 'N/A';
  return [
    `Protein Hunger: ${Math.round(needs.proteinHunger)}/100`,
    `Plant Hunger: ${Math.round(needs.plantHunger)}/100`,
    `Thirst: ${Math.round(needs.thirst)}/100`,
    `Stamina: ${Math.round(needs.stamina)}/100`,
    `Health: ${Math.round(needs.health)}/100`,
    `Social: ${Math.round(needs.social)}/100`,
    `Shelter: ${Math.round(needs.shelter)}/100`,
  ].join('\n');
}

function formatMetrics(metrics: LifeMetrics): string {
  if (!metrics) return 'N/A';
  return [
    `Ticks alive: ${metrics.totalTicksAlive}`,
    `Animals killed: ${metrics.animalsKilled}`,
    `Damage dealt/taken: ${Math.round(metrics.damageDealt)}/${Math.round(metrics.damageTaken)}`,
    `Times fled: ${metrics.timesFled}`,
    `Wood/Stone gathered: ${metrics.totalWoodGathered}/${metrics.totalStoneGathered}`,
    `Structures built: ${metrics.structuresBuilt}`,
    `Items crafted: ${metrics.itemsCrafted}`,
    `Needs satisfaction avg: ${Math.round(metrics.needsSatisfactionAvg)}%`,
    `Times health < 30%: ${metrics.timesHealthBelow30}`,
  ].join('\n');
}

function formatHeatmap(heatmap: { x: number; y: number; ticks: number }[]): string {
  if (!heatmap || heatmap.length === 0) return 'unknown';
  const sorted = [...heatmap].sort((a, b) => b.ticks - a.ticks);
  return sorted.slice(0, 3).map(h => '(' + h.x + ',' + h.y + '): ' + h.ticks + ' ticks').join(', ');
}

function formatEvents(events: { tick: number; type: string; details: string }[]): string {
  return events.slice(-30).map(e => '[tick ' + e.tick + '] ' + e.type + ': ' + e.details).join('\n');
}

function formatDeathHistory(journals: LifeJournal[]): string {
  return journals.map(j => {
    const cause = j.deathCause?.type ?? 'unknown';
    const killer = j.deathCause?.killerSpecies ? ' by ' + j.deathCause.killerSpecies : '';
    return 'Life #' + j.lifeNumber + ': survived ' + j.survivalTicks + 't, died from ' + cause + killer;
  }).join('\n');
}
