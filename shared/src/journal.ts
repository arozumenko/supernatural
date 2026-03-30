// ============================================================
// Life Journal — experience recording per agent life
// ============================================================

import type { AgentNeeds, BaseStats, PersonalityTrait, Resources } from './index.ts';

export interface LifeJournal {
  agentId: string;
  agentName: string;
  lifeNumber: number;
  livesRemaining: number;

  // Snapshot at birth
  birthTick: number;
  birthStats: BaseStats;
  birthSkills: Record<string, number>;
  birthPersonality: PersonalityTrait[];
  genomeVersion: number;

  // Life summary (computed at death)
  deathTick: number;
  deathCause: DeathCause;
  survivalTicks: number;

  // Performance metrics
  metrics: LifeMetrics;

  // Action timeline (sampled every 100 ticks)
  timeline: TimelineEntry[];

  // Significant events
  events: LifeEvent[];

  // Spatial heatmap (sampled every 300 ticks, aggregated at death)
  heatmap: { x: number; y: number; ticks: number }[];

  // Final state snapshot
  finalNeeds: AgentNeeds;
  finalResources: Resources;
  finalSkillLevels: Record<string, number>;
  finalInventory: string[];
}

export interface DeathCause {
  type: 'starvation_protein' | 'starvation_plant' | 'starvation_both'
      | 'dehydration' | 'killed_by_animal' | 'killed_by_agent' | 'exhaustion'
      | 'poison';
  killerSpecies?: string;
  killerAgent?: string;
  location: { x: number; y: number };
  needsAtDeath: AgentNeeds;
  lastActions: string[];
}

export interface LifeMetrics {
  // Survival
  totalTicksAlive: number;
  longestTicksWithoutDamage: number;
  timesHealthBelow30: number;
  timesStaminaBelow15: number;

  // Resource gathering
  totalWoodGathered: number;
  totalStoneGathered: number;
  totalMeatGathered: number;
  totalFoodForaged: number;
  totalIronMined: number;

  // Combat
  animalsKilled: number;
  animalsKilledBySpecies: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
  timesFled: number;
  timesRetaliatedSuccessfully: number;

  // Building & crafting
  structuresBuilt: number;
  itemsCrafted: number;
  highestCraftTier: number;

  // Social
  agentsInteractedWith: number;
  playerMessagesReceived: number;
  playerMessagesFollowed: number;
  animalsTamed: number;

  // Efficiency
  actionsPerTick: number;
  needsSatisfactionAvg: number;
  resourcesAtDeath: number;
}

export interface TimelineEntry {
  tick: number;
  action: string;
  reason: string;
  needs: { protein: number; plant: number; thirst: number; stamina: number; health: number };
  position: { x: number; y: number };
  nearbyThreats: number;
}

export type LifeEventType =
  | 'combat_start' | 'combat_end' | 'killed_animal' | 'took_damage'
  | 'crafted_item' | 'built_structure' | 'tamed_animal' | 'player_message'
  | 'need_critical' | 'need_recovered' | 'found_resource' | 'strategy_rule_fired'
  | 'goap_plan_started' | 'goap_plan_failed' | 'fled_from' | 'close_call'
  | 'plan_completed' | 'plan_abandoned';

export interface LifeEvent {
  tick: number;
  type: LifeEventType;
  details: string;
  data?: Record<string, any>;
}
