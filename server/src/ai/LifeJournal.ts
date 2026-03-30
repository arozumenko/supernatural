import type {
  AgentState, AgentNeeds, LifeJournal, DeathCause, LifeMetrics,
  TimelineEntry, LifeEvent, LifeEventType,
} from '../../shared/src/index.ts';

// ─── Journal Initialization ───

export function initJournal(agent: AgentState, birthTick: number): void {
  const journal: LifeJournal = {
    agentId: agent.id,
    agentName: agent.name,
    lifeNumber: agent.totalDeaths + 1,
    livesRemaining: agent.livesRemaining ?? 100,

    birthTick,
    birthStats: { ...agent.baseStats },
    birthSkills: extractSkillLevels(agent),
    birthPersonality: [...agent.personality],
    genomeVersion: (agent as any).currentGenome?.version ?? 1,

    deathTick: 0,
    deathCause: null as any,
    survivalTicks: 0,

    metrics: createEmptyMetrics(),
    timeline: [],
    events: [],
    heatmap: [],

    finalNeeds: null as any,
    finalResources: null as any,
    finalSkillLevels: {},
    finalInventory: [],
  };

  (agent as any).currentJournal = journal;
  // Running metrics tracked during life
  (agent as any)._metricsAccum = createMetricsAccumulator();
}

// ─── Timeline Sampling (every 100 ticks) ───

export function recordTimelineEntry(agent: AgentState, tick: number): void {
  const journal: LifeJournal | null = (agent as any).currentJournal;
  if (!journal) return;

  const entry: TimelineEntry = {
    tick,
    action: agent.action,
    reason: agent.currentPlanGoal ?? agent.action,
    needs: {
      protein: Math.round(agent.needs.proteinHunger),
      plant: Math.round(agent.needs.plantHunger),
      thirst: Math.round(agent.needs.thirst),
      stamina: Math.round(agent.needs.stamina),
      health: Math.round(agent.needs.health),
    },
    position: { x: Math.floor(agent.x), y: Math.floor(agent.y) },
    nearbyThreats: 0, // filled by caller if available
  };

  journal.timeline.push(entry);
}

// ─── Heatmap Sampling (every 300 ticks) ───

export function recordHeatmapEntry(agent: AgentState, _tick: number): void {
  const journal: LifeJournal | null = (agent as any).currentJournal;
  if (!journal) return;

  const x = Math.floor(agent.x);
  const y = Math.floor(agent.y);

  // Find existing entry for this position or create new
  const existing = journal.heatmap.find(h => h.x === x && h.y === y);
  if (existing) {
    existing.ticks++;
  } else {
    journal.heatmap.push({ x, y, ticks: 1 });
  }
}

// ─── API Event Emitter ───

import type { EventEmitter } from 'events';

let apiEmitter: EventEmitter | null = null;

export function setApiEventEmitter(emitter: EventEmitter): void {
  apiEmitter = emitter;
}

// ─── Event Recording ───

export function recordLifeEvent(
  agent: AgentState,
  type: LifeEventType,
  details: string,
  data?: Record<string, any>,
  tick?: number
): void {
  const journal: LifeJournal | null = (agent as any).currentJournal;
  if (!journal) return;

  const event: LifeEvent = {
    tick: tick ?? agent.age,
    type,
    details,
    data,
  };

  journal.events.push(event);

  // Emit to API SSE listeners
  if (apiEmitter) {
    apiEmitter.emit('agent:event', { agentId: agent.id, type, tick: event.tick, details });
  }
}

// ─── Death Cause Detection (9-way) ───

export function detectDeathCause(agent: AgentState, tickCount: number): DeathCause {
  const lastActions = (agent as any).currentJournal?.timeline?.slice(-10).map((t: TimelineEntry) => t.action) ?? [];
  const location = { x: Math.floor(agent.x), y: Math.floor(agent.y) };
  const needsAtDeath = { ...agent.needs };

  // 1. Combat kills take priority (proximate cause)
  if (agent.lastAttackedBy && (tickCount - agent.lastAttackedBy.tick) < 30) {
    if (agent.lastAttackedBy.type === 'animal') {
      return {
        type: 'killed_by_animal',
        killerSpecies: agent.lastAttackedBy.id,
        location,
        needsAtDeath,
        lastActions,
      };
    }
    if (agent.lastAttackedBy.type === 'agent') {
      return {
        type: 'killed_by_agent',
        killerAgent: agent.lastAttackedBy.id,
        location,
        needsAtDeath,
        lastActions,
      };
    }
  }

  // 2-5. Need-based causes
  if (agent.needs.proteinHunger <= 0 && agent.needs.plantHunger <= 0) {
    return { type: 'starvation_both', location, needsAtDeath, lastActions };
  }
  if (agent.needs.proteinHunger <= 0) {
    return { type: 'starvation_protein', location, needsAtDeath, lastActions };
  }
  if (agent.needs.plantHunger <= 0) {
    return { type: 'starvation_plant', location, needsAtDeath, lastActions };
  }
  if (agent.needs.thirst <= 0) {
    return { type: 'dehydration', location, needsAtDeath, lastActions };
  }

  // 8. Poison check
  if ((agent as any).poisoned) {
    return { type: 'poison', location, needsAtDeath, lastActions };
  }

  // 7/9. Exhaustion fallback
  return { type: 'exhaustion', location, needsAtDeath, lastActions };
}

// ─── Journal Finalization (on death) ───

export function finalizeJournal(
  agent: AgentState,
  deathCause: DeathCause,
  currentTick: number
): LifeJournal {
  const journal: LifeJournal = (agent as any).currentJournal;
  if (!journal) {
    // Safety: create minimal journal if somehow missing
    initJournal(agent, currentTick);
    return finalizeJournal(agent, deathCause, currentTick);
  }

  journal.deathTick = currentTick;
  journal.deathCause = deathCause;
  journal.survivalTicks = currentTick - journal.birthTick;
  journal.finalNeeds = { ...agent.needs };
  journal.finalResources = { ...agent.resources };
  journal.finalSkillLevels = extractSkillLevels(agent);
  journal.finalInventory = agent.inventory.items.map(i => i.itemId);

  // Compute metrics from accumulator
  const accum = (agent as any)._metricsAccum ?? createMetricsAccumulator();
  journal.metrics = finalizeMetrics(accum, journal.survivalTicks, agent);

  // Aggregate heatmap into coarser grid (12x9 chunks for 120x90 world)
  journal.heatmap = aggregateHeatmap(journal.heatmap);

  return journal;
}

// ─── Metrics Accumulator ───

interface MetricsAccumulator {
  woodGathered: number;
  stoneGathered: number;
  meatGathered: number;
  foodForaged: number;
  ironMined: number;
  animalsKilled: number;
  animalsKilledBySpecies: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
  timesFled: number;
  timesRetaliated: number;
  structuresBuilt: number;
  itemsCrafted: number;
  highestCraftTier: number;
  agentsInteractedWith: Set<string>;
  playerMessagesReceived: number;
  playerMessagesFollowed: number;
  animalsTamed: number;
  nonIdleTicks: number;
  needsSumTotal: number;
  needsSamples: number;
  ticksWithoutDamage: number;
  longestWithoutDamage: number;
  timesHealthBelow30: number;
  timesStaminaBelow15: number;
}

function createMetricsAccumulator(): MetricsAccumulator {
  return {
    woodGathered: 0, stoneGathered: 0, meatGathered: 0,
    foodForaged: 0, ironMined: 0,
    animalsKilled: 0, animalsKilledBySpecies: {},
    damageDealt: 0, damageTaken: 0, timesFled: 0, timesRetaliated: 0,
    structuresBuilt: 0, itemsCrafted: 0, highestCraftTier: 0,
    agentsInteractedWith: new Set(),
    playerMessagesReceived: 0, playerMessagesFollowed: 0,
    animalsTamed: 0,
    nonIdleTicks: 0, needsSumTotal: 0, needsSamples: 0,
    ticksWithoutDamage: 0, longestWithoutDamage: 0,
    timesHealthBelow30: 0, timesStaminaBelow15: 0,
  };
}

function finalizeMetrics(accum: MetricsAccumulator, survivalTicks: number, agent: AgentState): LifeMetrics {
  const totalResources = Object.values(agent.resources).reduce((a, b) => a + b, 0);

  return {
    totalTicksAlive: survivalTicks,
    longestTicksWithoutDamage: accum.longestWithoutDamage,
    timesHealthBelow30: accum.timesHealthBelow30,
    timesStaminaBelow15: accum.timesStaminaBelow15,
    totalWoodGathered: accum.woodGathered,
    totalStoneGathered: accum.stoneGathered,
    totalMeatGathered: accum.meatGathered,
    totalFoodForaged: accum.foodForaged,
    totalIronMined: accum.ironMined,
    animalsKilled: accum.animalsKilled,
    animalsKilledBySpecies: { ...accum.animalsKilledBySpecies },
    damageDealt: accum.damageDealt,
    damageTaken: accum.damageTaken,
    timesFled: accum.timesFled,
    timesRetaliatedSuccessfully: accum.timesRetaliated,
    structuresBuilt: accum.structuresBuilt,
    itemsCrafted: accum.itemsCrafted,
    highestCraftTier: accum.highestCraftTier,
    agentsInteractedWith: accum.agentsInteractedWith.size,
    playerMessagesReceived: accum.playerMessagesReceived,
    playerMessagesFollowed: accum.playerMessagesFollowed,
    animalsTamed: accum.animalsTamed,
    actionsPerTick: survivalTicks > 0 ? accum.nonIdleTicks / survivalTicks : 0,
    needsSatisfactionAvg: accum.needsSamples > 0 ? accum.needsSumTotal / accum.needsSamples : 50,
    resourcesAtDeath: totalResources,
  };
}

// ─── Metrics Update Helpers (called from hooks) ───

export function trackMetric(agent: AgentState, metric: string, value: number = 1): void {
  const accum: MetricsAccumulator = (agent as any)._metricsAccum;
  if (!accum) return;

  switch (metric) {
    case 'woodGathered': accum.woodGathered += value; break;
    case 'stoneGathered': accum.stoneGathered += value; break;
    case 'meatGathered': accum.meatGathered += value; break;
    case 'foodForaged': accum.foodForaged += value; break;
    case 'ironMined': accum.ironMined += value; break;
    case 'damageDealt': accum.damageDealt += value; break;
    case 'damageTaken':
      accum.damageTaken += value;
      accum.longestWithoutDamage = Math.max(accum.longestWithoutDamage, accum.ticksWithoutDamage);
      accum.ticksWithoutDamage = 0;
      break;
    case 'animalKilled':
      accum.animalsKilled++;
      break;
    case 'fled': accum.timesFled++; break;
    case 'retaliated': accum.timesRetaliated++; break;
    case 'structureBuilt': accum.structuresBuilt++; break;
    case 'itemCrafted': accum.itemsCrafted++; break;
    case 'animalTamed': accum.animalsTamed++; break;
    case 'messageReceived': accum.playerMessagesReceived++; break;
    case 'messageFollowed': accum.playerMessagesFollowed++; break;
  }
}

export function trackAnimalKill(agent: AgentState, species: string): void {
  const accum: MetricsAccumulator = (agent as any)._metricsAccum;
  if (!accum) return;
  accum.animalsKilled++;
  accum.animalsKilledBySpecies[species] = (accum.animalsKilledBySpecies[species] ?? 0) + 1;
}

export function trackAgentInteraction(agent: AgentState, otherAgentId: string): void {
  const accum: MetricsAccumulator = (agent as any)._metricsAccum;
  if (!accum) return;
  accum.agentsInteractedWith.add(otherAgentId);
}

export function tickMetrics(agent: AgentState): void {
  const accum: MetricsAccumulator = (agent as any)._metricsAccum;
  if (!accum) return;

  if (agent.action !== 'idle') accum.nonIdleTicks++;
  accum.ticksWithoutDamage++;

  // Sample needs satisfaction
  const needs = agent.needs;
  const avgNeed = (needs.proteinHunger + needs.plantHunger + needs.thirst + needs.stamina + needs.health) / 5;
  accum.needsSumTotal += avgNeed;
  accum.needsSamples++;

  // Track critical thresholds
  if (needs.health < 30) accum.timesHealthBelow30++;
  if (needs.stamina < 15) accum.timesStaminaBelow15++;
}

// ─── Helpers ───

function extractSkillLevels(agent: AgentState): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const [name, skill] of Object.entries(agent.skills)) {
    levels[name] = skill.level;
  }
  return levels;
}

function aggregateHeatmap(rawHeatmap: { x: number; y: number; ticks: number }[]): { x: number; y: number; ticks: number }[] {
  // Aggregate into 10x10 tile chunks
  const chunkSize = 10;
  const chunks = new Map<string, { x: number; y: number; ticks: number }>();

  for (const entry of rawHeatmap) {
    const cx = Math.floor(entry.x / chunkSize) * chunkSize;
    const cy = Math.floor(entry.y / chunkSize) * chunkSize;
    const key = `${cx},${cy}`;
    const existing = chunks.get(key);
    if (existing) {
      existing.ticks += entry.ticks;
    } else {
      chunks.set(key, { x: cx, y: cy, ticks: entry.ticks });
    }
  }

  return Array.from(chunks.values());
}

function createEmptyMetrics(): LifeMetrics {
  return {
    totalTicksAlive: 0, longestTicksWithoutDamage: 0,
    timesHealthBelow30: 0, timesStaminaBelow15: 0,
    totalWoodGathered: 0, totalStoneGathered: 0,
    totalMeatGathered: 0, totalFoodForaged: 0, totalIronMined: 0,
    animalsKilled: 0, animalsKilledBySpecies: {},
    damageDealt: 0, damageTaken: 0, timesFled: 0, timesRetaliatedSuccessfully: 0,
    structuresBuilt: 0, itemsCrafted: 0, highestCraftTier: 0,
    agentsInteractedWith: 0, playerMessagesReceived: 0,
    playerMessagesFollowed: 0, animalsTamed: 0,
    actionsPerTick: 0, needsSatisfactionAvg: 50, resourcesAtDeath: 0,
  };
}
