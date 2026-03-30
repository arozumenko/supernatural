// ============================================================
// Behavior Genome — per-agent learned decision config
// ============================================================

export interface BehaviorGenome {
  // === IDENTITY ===
  version: number;
  generation: number;
  lineage: string[];

  // === INTERRUPT LAYER (Layer 1) ===
  interruptWeights: {
    criticalThirst: number;       // default 95, range [60, 99]
    fightBack: number;            // default 93
    criticalHunger: number;       // default 90
    lowHealth: number;            // default 88
    staminaHerb: number;          // default 82
    exhaustionRest: number;       // default 80
    groupDefense: number;         // default 75
    fleeBase: number;             // default 70
  };

  // === MEDIUM PRIORITY LAYER ===
  mediumPriorityWeights: {
    drinkMedium: number;          // default 60
    eatMedium: number;            // default 55
    forageMedium: number;         // default 55
  };

  // === INTERRUPT THRESHOLDS ===
  thresholds: {
    criticalThirst: number;       // default 20
    criticalHunger: number;       // default 20
    criticalStamina: number;      // default 15
    criticalHealth: number;       // default 30
    moderateHealth: number;       // default 60
    fleeHealthPanic: number;      // default 0.3
    fightBackMinRatio: number;    // default 0.5
    groupDefenseRange: number;    // default 8

    // Resource thresholds
    meatMinimum: number;          // default 3
    woodMinimum: number;          // default 10
    stoneMinimum: number;         // default 5
    ironOreMinimum: number;       // default 4

    // Planting thresholds
    plantHungerTrigger: number;   // default 60
    woodToKeepBeforePlanting: number; // default 5

    // Detection ranges
    threatDetectBase: number;     // default 6
    huntDetectRange: number;      // default 15
    socialDetectRange: number;    // default 15
    corpseDetectRange: number;    // default 15
    ironDetectRange: number;      // default 20
  };

  // === GOAP LAYER (Layer 2) ===
  goalWeights: {
    survive_thirst: number;
    survive_protein: number;
    survive_plant: number;
    rest: number;
    get_shelter: number;
    get_equipped: number;
    socialize: number;
    stockpile_wood: number;
    stockpile_stone: number;
    cook_food: number;
    [key: string]: number;
  };

  actionCostMods: Record<string, number>;

  goalThresholds: {
    thirstRelevant: number;       // default 50
    proteinRelevant: number;      // default 50
    plantRelevant: number;        // default 50
    staminaRelevant: number;      // default 30
    shelterRelevant: number;      // default 40
    socialRelevant: number;       // default 40
    woodTarget: number;           // default 15
    stoneTarget: number;          // default 8
  };

  // === FALLBACK LAYER (Layer 3) ===
  fallbackWeights: {
    drinkMedium: number;          // default 60
    eatMedium: number;            // default 55
    harvestCorpse: number;        // default 50
    gatherWood: number;           // default 35
    mineStone: number;            // default 30
    huntAnimal: number;           // default 40
    socialize: number;            // default 30
    mineIron: number;             // default 28
    craft: number;                // default 25
    tameAnimal: number;           // default 20
    plantSeeds: number;           // default 20
    wander: number;               // default 10
  };

  // === STRATEGY RULES (LLM-generated) ===
  strategyRules: StrategyRule[];

  // === META ===
  createdAt: number;
  mutatedAt: number;
  fitnessScore: number;
}

// --- Strategy Rules ---

export interface StrategyRule {
  id: string;
  name: string;
  condition: RuleCondition;
  effect: RuleEffect;
  priority: number;               // 1-99
  enabled: boolean;
  source: string;
}

export interface RuleCondition {
  type: 'need_below' | 'need_above' | 'resource_below' | 'resource_above'
      | 'near_entity' | 'time_of_day' | 'health_percent' | 'skill_level'
      | 'deaths_remaining' | 'and' | 'or' | 'not';
  field?: string;
  value?: number;
  entityType?: string;
  range?: number;
  conditions?: RuleCondition[];
}

export interface RuleEffect {
  type: 'boost_priority' | 'suppress_action' | 'force_action'
      | 'modify_threshold' | 'modify_weight' | 'flee_from' | 'prefer_target';
  action?: string;
  amount?: number;
  targetField?: string;
  targetValue?: number;
}

// --- Safety Bounds ---

export const GENOME_BOUNDS = {
  interruptWeights: { min: 60, max: 99 },
  mediumPriorityWeights: { min: 40, max: 70 },
  thresholds: {
    needs: { min: 15, max: 95 },      // min 15 so critical checks always fire when in danger
    goalThresholds: { min: 20, max: 80 }, // min 20 so GOAP/fallback goals activate when needs drop
    resources: { min: 0, max: 50 },
    detection: { min: 3, max: 30 },
    fleeHealthPanic: { min: 0.1, max: 0.8 },
    fightBackMinRatio: { min: 0.1, max: 2.0 },
  },
  goalWeights: { min: 0.1, max: 5.0 },
  actionCostMods: { min: 0.2, max: 5.0 },
  fallbackWeights: { min: 5, max: 70 },
  strategyRules: { maxCount: 15 },
  rulePriority: { min: 1, max: 99 },
  survivalGoalMinWeight: 0.3,
} as const;

// --- LLM Provider Config ---

export interface LLMProviderConfig {
  id: string;
  label: string;
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'openai_compatible' | 'bedrock';
  model: string;
  apiKey: string;
  baseUrl?: string;              // custom endpoint for openai_compatible/ollama
  maxTokens: number;
  temperature: number;
  timeout: number;
  maxConcurrent: number;
  rateLimitPerMinute: number;
}
