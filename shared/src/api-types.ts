// ============================================================
// Agent API Types — observation, instruction, auth
// ============================================================

import type { AgentAction, AgentNeeds } from './index.ts';

// === Plan System ===

export interface ActionPlan {
  name: string;
  steps: PlanStep[];
  priority: number;              // 1-80
  expireAfterTicks: number;
  abandonOnDanger: boolean;
}

export interface PlanStep {
  action: AgentAction;
  target?: {
    type: 'position' | 'entity' | 'resource' | 'nearest';
    x?: number;
    y?: number;
    entityId?: string;
    resourceType?: string;
  };
  condition?: PlanCondition;
  maxTicks?: number;
}

export interface PlanCondition {
  type: 'resource_above' | 'need_above' | 'at_position' | 'item_crafted' | 'ticks_elapsed';
  field?: string;
  value?: number;
  position?: { x: number; y: number; radius: number };
}

export interface ActivePlan extends ActionPlan {
  planId: string;
  currentStep: number;
  startTick: number;
  stepStartTick: number;
  expiresAtTick: number;
}

// === API Key ===

export type ApiPermission = 'observe' | 'message' | 'plan' | 'genome';

export interface ApiRateLimit {
  observePerMinute: number;
  messagePerMinute: number;
  planPerMinute: number;
  genomePatchPerMinute: number;
}

export interface ApiKey {
  id: string;
  playerId: string;
  name: string;
  keyHash: string;
  createdAt: number;
  lastUsedAt: number;
  rateLimit: ApiRateLimit;
  permissions: ApiPermission[];
  active: boolean;
}

// === Observation ===

export interface AgentSummary {
  id: string;
  name: string;
  alive: boolean;
  age: number;
  totalDeaths: number;
  livesRemaining: number;

  position: { x: number; y: number };
  currentAction: string;
  actionReason: string;
  biome: string;

  needs: {
    proteinHunger: number;
    plantHunger: number;
    thirst: number;
    stamina: number;
    health: number;
    social: number;
    shelter: number;
  };
  urgentNeeds: string[];

  resources: Record<string, number>;
  equipment: {
    mainHand: string | null;
    body: string | null;
    accessory: string | null;
  };
  carryWeight: number;
  carryCapacity: number;

  skills: Record<string, number>;
  personality: string[];
  obedience: number;
  socialScore: number;

  currentPlan: {
    goal: string;
    steps: string[];
    currentStep: number;
  } | null;

  nearby: {
    threats: NearbyEntity[];
    resources: NearbyResource[];
    agents: NearbyAgent[];
    corpses: NearbyCorpse[];
  };

  genome: {
    version: number;
    generation: number;
    activeStrategyRules: string[];
    fitnessScore: number;
  };
  currentLifeTicks: number;
  lifetimeBestSurvival: number;
  isHighlander: boolean;

  recentEvents: {
    tick: number;
    type: string;
    details: string;
  }[];

  pendingMessages: number;
  lastMessageFollowed: boolean | null;

  serverTick: number;
  serverTime: string;
}

export interface NearbyEntity {
  type: string;
  name?: string;
  distance: number;
  direction: string;
  dangerLevel: 'low' | 'medium' | 'high' | 'extreme';
}

export interface NearbyResource {
  type: string;
  distance: number;
  direction: string;
  quantity?: number;
}

export interface NearbyAgent {
  id: string;
  name: string;
  distance: number;
  direction: string;
  relationship: number;
  alive: boolean;
}

export interface NearbyCorpse {
  species: string;
  distance: number;
  direction: string;
  ticksRemaining: number;
}

export interface WorldSummary {
  tick: number;
  season: string;
  population: {
    agents: { alive: number; dead: number; total: number };
    animals: Record<string, number>;
  };
  resources: {
    ironDepositsRemaining: number;
    averageTreeDensity: number;
  };
  recentEvents: {
    tick: number;
    type: string;
    message: string;
  }[];
  highlander: { id: string; name: string } | null;
}

// === Error ===

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, any>;
}

// === LLM Orchestrator Response ===

export interface LLMResponse {
  actions: LLMAction[];
  reasoning?: string;
}

export type LLMAction =
  | { type: 'observe_only' }
  | { type: 'message'; content: string; urgent?: boolean }
  | { type: 'plan'; plan: ActionPlan }
  | { type: 'genome_patch'; patches: JsonPatch[]; reason: string };

// === Game Results ===

export interface GameResults {
  ticksPlayed: number;
  season: string;
  agents: AgentResult[];
  bestGenome: any;  // BehaviorGenome
  topAnimals: {
    apex: AnimalResult | null;
    midPredator: AnimalResult | null;
    largeHerb: AnimalResult | null;
    mediumHerb: AnimalResult | null;
    smallPrey: AnimalResult | null;
  };
  scoreHistory: Record<string, { tick: number; score: number }[]>;
  notableEvents: Record<string, { tick: number; event: string }[]>;
  comparison: {
    llmAvgEffectiveness: number;
    dtAvgEffectiveness: number;
    llmAvgSurvival: number;
    dtAvgSurvival: number;
    bestApproach: 'llm' | 'decision_tree' | 'tie';
    perRole: Record<string, { count: number; avgEffectiveness: number }>;
  };
}

export interface AgentResult {
  rank: number;
  name: string;
  effectiveness: number;
  bestLifeTicks: number;
  livesRemaining: number;
  totalDeaths: number;
  totalSkillLevels: number;
  aiRole: string;
  aiProvider: string | null;
  archetype: string;
  genomeVersion: number;
}

export interface AnimalResult {
  species: string;
  tier: string;
  effectiveness: number;
  ticksAlive: number;
  kills: number;
  timesBreed: number;
  skillLevels: number;
}

// === JSON Patch (RFC 6902 subset) ===

export interface JsonPatch {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: any;
}
