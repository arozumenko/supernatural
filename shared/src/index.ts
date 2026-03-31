// ============================================================
// Supernatural - Shared Types & Constants
// ============================================================

// Re-export genome and journal types
export type {
  BehaviorGenome, StrategyRule, RuleCondition, RuleEffect,
  LLMProviderConfig,
} from './genome.ts';
export { GENOME_BOUNDS } from './genome.ts';
export type {
  LifeJournal, DeathCause, LifeMetrics, TimelineEntry,
  LifeEvent, LifeEventType,
} from './journal.ts';
export type {
  ActionPlan, ActivePlan, PlanStep, PlanCondition,
  ApiKey, ApiRateLimit, ApiPermission,
  AgentSummary, WorldSummary, NearbyEntity, NearbyResource, NearbyAgent, NearbyCorpse,
  ApiError, JsonPatch,
  LLMResponse, LLMAction,
  GameResults, AgentResult, AnimalResult,
} from './api-types.ts';
import type { GameResults as _GameResults } from './api-types.ts';
// Make GameResults available in this file's scope for ServerToClientEvents
type GameResults = _GameResults;

// --- Orchestrator Roles ---

export type OrchestratorRole =
  | 'advisor' | 'puppeteer' | 'god' | 'darwinist' | 'parent' | 'chaos_demon' | 'none';

export interface OrchestratorConfig {
  role: OrchestratorRole;
  providerId: string;
  observeIntervalMs: number;
  enabled: boolean;
}

export const ROLE_PERMISSIONS: Record<OrchestratorRole, {
  canMessage: boolean;
  canPlan: boolean;
  canPatchGenome: boolean;
  observeIntervalMs: number;
  description: string;
}> = {
  advisor:      { canMessage: true,  canPlan: false, canPatchGenome: false, observeIntervalMs: 30000, description: 'Quiet voice. Messages only.' },
  puppeteer:    { canMessage: true,  canPlan: true,  canPatchGenome: false, observeIntervalMs: 15000, description: 'Tactical commander. Plans + messages.' },
  god:          { canMessage: false, canPlan: false, canPatchGenome: true,  observeIntervalMs: 15000, description: 'Silent hand. Genome patches only.' },
  darwinist:    { canMessage: true,  canPlan: true,  canPatchGenome: true,  observeIntervalMs: 10000, description: 'Cold optimizer. All tiers.' },
  parent:       { canMessage: true,  canPlan: true,  canPatchGenome: false, observeIntervalMs: 15000, description: 'Teaches then lets go.' },
  chaos_demon:  { canMessage: true,  canPlan: true,  canPatchGenome: true,  observeIntervalMs: 15000, description: 'Entropy agent. Unpredictable.' },
  none:         { canMessage: false, canPlan: false, canPatchGenome: false, observeIntervalMs: 0,     description: 'No LLM. Decision tree only.' },
};

// --- Agent Archetypes ---

export type AgentArchetype = 'random' | 'warrior' | 'survivor' | 'builder' | 'scout' | 'social';

// Each archetype has exactly 66 total stat points (avg 11 per stat), distributed differently
export const AGENT_ARCHETYPES: Record<AgentArchetype, {
  label: string;
  description: string;
  stats: Record<'strength' | 'toughness' | 'agility' | 'endurance' | 'perception' | 'charisma', number>;
  genomeOverrides?: Record<string, any>;
}> = {
  // All archetypes: 66 total, min 10, max 13 — gentle skew, no dump stats
  random:   { label: '\uD83C\uDFB2', description: 'All stats randomized',
    stats: { strength: 11, toughness: 11, agility: 11, endurance: 11, perception: 11, charisma: 11 } },
  warrior:  { label: '\u2694\uFE0F', description: 'STR+TGH, combat focus',
    stats: { strength: 13, toughness: 13, agility: 11, endurance: 10, perception: 10, charisma: 9 },
    genomeOverrides: {
      'fallbackWeights.huntAnimal': 55, 'interruptWeights.fightBack': 95, 'thresholds.fightBackMinRatio': 0.4,
      'fallbackWeights.socialize': 12, 'goalWeights.socialize': 0.4,
      'thresholds.foodTarget': 4, 'thresholds.woodTarget': 5, 'thresholds.stoneTarget': 3, // light packer — hunts for food
    } },
  survivor: { label: '\uD83D\uDEE1\uFE0F', description: 'END+TGH, survival focus',
    stats: { strength: 10, toughness: 13, agility: 10, endurance: 13, perception: 11, charisma: 9 },
    genomeOverrides: {
      'interruptWeights.fleeBase': 82, 'thresholds.criticalThirst': 35, 'thresholds.criticalHunger': 35, 'thresholds.fleeHealthPanic': 0.5,
      'fallbackWeights.socialize': 20, 'goalWeights.socialize': 0.7,
      'thresholds.foodTarget': 10, 'thresholds.woodTarget': 15, 'thresholds.stoneTarget': 8, // hoarder — stockpiles everything
    } },
  builder:  { label: '\uD83D\uDD28', description: 'STR+END, build focus',
    stats: { strength: 13, toughness: 10, agility: 10, endurance: 13, perception: 11, charisma: 9 },
    genomeOverrides: {
      'fallbackWeights.gatherWood': 50, 'fallbackWeights.mineStone': 45, 'goalWeights.get_shelter': 1.8, 'goalWeights.get_equipped': 1.5,
      'fallbackWeights.socialize': 25, 'goalWeights.socialize': 0.8,
      'thresholds.foodTarget': 6, 'thresholds.woodTarget': 25, 'thresholds.stoneTarget': 15, // needs building materials
    } },
  scout:    { label: '\uD83D\uDC41\uFE0F', description: 'AGI+PER, explore focus',
    stats: { strength: 10, toughness: 10, agility: 13, endurance: 11, perception: 13, charisma: 9 },
    genomeOverrides: {
      'thresholds.threatDetectBase': 10, 'thresholds.huntDetectRange': 20, 'fallbackWeights.wander': 25,
      'fallbackWeights.socialize': 10, 'goalWeights.socialize': 0.3,
      'thresholds.foodTarget': 8, 'thresholds.woodTarget': 5, 'thresholds.stoneTarget': 3, // travels light
    } },
  social:   { label: '\uD83E\uDD1D', description: 'CHA+PER, trades to survive',
    stats: { strength: 9, toughness: 10, agility: 10, endurance: 10, perception: 13, charisma: 14 },
    genomeOverrides: {
      'fallbackWeights.socialize': 55, 'fallbackWeights.tameAnimal': 35, 'goalWeights.socialize': 2.5,
      'thresholds.socialDetectRange': 25, 'fallbackWeights.huntAnimal': 20, 'fallbackWeights.gatherWood': 20, 'fallbackWeights.mineStone': 15,
      'thresholds.foodTarget': 10, 'thresholds.woodTarget': 8, 'thresholds.stoneTarget': 5, // trades for what it needs, hoards food
    } },
};

// --- World ---

export let WORLD_WIDTH = 120;
export let WORLD_HEIGHT = 90;
export const TILE_SIZE = 32;
export const TICK_RATE = 10; // server ticks per second
export const MAX_AGENTS = 50;

// --- Game Configuration ---

export interface GameConfig {
  worldWidth: number;
  worldHeight: number;
  agentCount: number;
  waterCoverage: number;      // 0.1-0.4
  natureBudget: number;       // 0.25-0.55
  maxAnimals: number;         // 100-300
  // LLM assignments: agent slot index -> provider + role (null = no LLM, fallback only)
  agentLLMAssignments?: Record<number, { providerId: string; role: OrchestratorRole } | null>;
  agentArchetypes?: Record<number, AgentArchetype>;
  agentGenomes?: Record<number, string | null>;  // genome ID from library, null = default
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  worldWidth: 120,
  worldHeight: 90,
  agentCount: 8,
  waterCoverage: 0.20,
  natureBudget: 0.40,
  maxAnimals: 200,
};

export function applyGameConfig(config: GameConfig): void {
  WORLD_WIDTH = config.worldWidth;
  WORLD_HEIGHT = config.worldHeight;
}

// --- Regions ---

export const REGION_SIZE = 10;
export const REGION_COLS = 12; // WORLD_WIDTH / REGION_SIZE
export const REGION_ROWS = 9;  // WORLD_HEIGHT / REGION_SIZE

export interface RegionState {
  seedBank: Partial<Record<PlantType, number>>;
  plantCount: number;
  herbivoreCount: number;
}

// --- Seasons ---

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_TICKS = 6000;
export const YEAR_TICKS = 24000;

export function getCurrentSeason(tick: number): Season {
  const phase = tick % YEAR_TICKS;
  if (phase < SEASON_TICKS) return 'spring';
  if (phase < SEASON_TICKS * 2) return 'summer';
  if (phase < SEASON_TICKS * 3) return 'autumn';
  return 'winter';
}

export interface SeasonModifiers {
  regrowthMult: number;
  breedingCooldownMult: number;  // multiplier on breed cooldown (>1 = slower breeding)
  staminaDecayMult: number;
  foodDropMult: number;
  migrationActive: boolean;
}

export const SEASON_MODIFIERS: Record<Season, SeasonModifiers> = {
  spring:  { regrowthMult: 2.0, breedingCooldownMult: 0.5, staminaDecayMult: 1.0, foodDropMult: 1.0, migrationActive: false },
  summer:  { regrowthMult: 1.0, breedingCooldownMult: 1.0, staminaDecayMult: 1.0, foodDropMult: 1.0, migrationActive: false },
  autumn:  { regrowthMult: 0.5, breedingCooldownMult: 1.0, staminaDecayMult: 1.0, foodDropMult: 1.5, migrationActive: false },
  winter:  { regrowthMult: 0.1, breedingCooldownMult: 3.0, staminaDecayMult: 1.5, foodDropMult: 1.0, migrationActive: true },
};

export const TileType = {
  GRASS: 0,
  WATER: 1,
  TREE: 2,
  STONE: 3,
  BERRY_BUSH: 4,
  SAND: 5,
  DIRT: 6,
  TREE_STUMP: 7,
  ROCK_RUBBLE: 8,
  BUILT_FLOOR: 10,
  BUILT_WALL: 11,
  CAMPFIRE: 12,
  WORKBENCH: 13,
  FORGE: 14,
  STONE_WALL: 15,
  IRON_WALL: 16,
  WOOD_DOOR: 17,
  BONE_FENCE: 18,
  STORAGE: 19,
  TENT: 20,
  BEDROLL: 21,
  ANIMAL_PEN: 22,
  IRON_ORE: 23,
  TOMBSTONE: 24,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

// --- Resources ---

export type ResourceType = 'wood' | 'stone' | 'food' | 'water';

export const TILE_WALKABLE: Record<number, boolean> = {
  [TileType.GRASS]: true,
  [TileType.WATER]: false,
  [TileType.TREE]: false,
  [TileType.STONE]: false,
  [TileType.BERRY_BUSH]: true,
  [TileType.SAND]: true,
  [TileType.DIRT]: true,
  [TileType.BUILT_FLOOR]: true,
  [TileType.BUILT_WALL]: false,
  [TileType.TREE_STUMP]: true,
  [TileType.ROCK_RUBBLE]: true,
  [TileType.CAMPFIRE]: true,
  [TileType.WORKBENCH]: true,
  [TileType.FORGE]: true,
  [TileType.STONE_WALL]: false,
  [TileType.IRON_WALL]: false,
  [TileType.WOOD_DOOR]: true,
  [TileType.BONE_FENCE]: false,
  [TileType.STORAGE]: true,
  [TileType.TENT]: true,
  [TileType.BEDROLL]: true,
  [TileType.ANIMAL_PEN]: false,
  [TileType.IRON_ORE]: false,
  [TileType.TOMBSTONE]: true,
};

export const TILE_HARVESTABLE: Record<number, ResourceType> = {
  [TileType.TREE]: 'wood',
};

export interface Resources {
  wood: number;
  stone: number;
  food: number;
  water: number;
  treeSeed: number;
  plantSeed: number;
  // Materials
  meat: number;
  bone: number;
  hide: number;
  sinew: number;
  fat: number;
  feathers: number;
  teeth_claws: number;
  scales: number;
  iron_ore: number;
  iron_ingot: number;
}

// --- Progression ---

export type SkillName =
  | 'combat' | 'defense' | 'athletics'
  | 'woodcutting' | 'mining' | 'foraging'
  | 'building' | 'crafting' | 'survival' | 'social';

export interface SkillState {
  xp: number;
  level: number;  // derived: floor(sqrt(xp / 50)), capped at skill cap
}

export interface SkillSet {
  combat: SkillState;
  defense: SkillState;
  athletics: SkillState;
  woodcutting: SkillState;
  mining: SkillState;
  foraging: SkillState;
  building: SkillState;
  crafting: SkillState;
  survival: SkillState;
  social: SkillState;
}

export interface BaseStats {
  strength: number;     // 5-15
  toughness: number;
  agility: number;
  endurance: number;
  perception: number;
  charisma: number;
}

// --- Agent ---

export interface AgentNeeds {
  proteinHunger: number;  // 0-100, 0 = starving (was: hunger)
  plantHunger: number;    // 0-100, 0 = starving
  thirst: number;     // 0-100, 0 = dehydrated
  stamina: number;    // 0-100, 0 = exhausted
  health: number;     // 0-100, 0 = dead
  social: number;     // 0-100, 0 = lonely
  shelter: number;    // 0-100, 0 = exposed
}

export type AgentAction =
  | 'idle'
  | 'wandering'
  | 'moving_to'
  | 'harvesting'
  | 'eating'
  | 'drinking'
  | 'resting'
  | 'building'
  | 'crafting'
  | 'socializing'
  | 'trading'
  | 'planting'
  | 'following_message'
  | 'dying';

export type PersonalityTrait = 'obedient' | 'independent' | 'social' | 'loner' | 'industrious' | 'lazy';

// GOAP plan step (serialized for client)
export interface GOAPPlanStep {
  actionId: string;
  actionName: string;
}

export interface AgentState {
  id: string;
  name: string;
  x: number;
  y: number;
  needs: AgentNeeds;
  resources: Resources;
  inventory: Inventory;
  action: AgentAction;
  actionTarget?: { x: number; y: number };
  personality: PersonalityTrait[];
  baseStats: BaseStats;
  skills: SkillSet;
  totalDeaths: number;
  socialScore: number;       // how important other agents think this agent is
  relationships: Record<string, number>; // agentId -> opinion (-100 to 100)
  lastAttackedBy?: { type: 'animal' | 'agent'; id: string; tick: number };
  attackCooldown: number;    // ticks until next attack allowed
  ownerId?: string;          // player who created this agent
  alive: boolean;
  age: number;               // ticks alive
  messageQueue: PlayerMessage[];
  lastMessage?: PlayerMessage;
  obedience: number;         // 0-100, how likely to follow player messages
  // GOAP plan state
  currentPlanGoal?: string;      // goal name for UI display
  currentPlanSteps?: GOAPPlanStep[];  // serialized plan for UI
  planStepIndex?: number;        // current step (0-based)
  // Spatial memory: remembered resource/danger locations
  spatialMemory?: SpatialMemoryEntry[];
  // Server-computed carry weight/capacity (for client display)
  carryWeight?: number;
  carryCapacity?: number;
  // Evolution system (lightweight wire fields — full genome/journal sent via REST)
  livesRemaining?: number;
  genomeVersion?: number;
  activeStrategyRuleNames?: string[];
  currentLifeTicks?: number;
  lifetimeBestSurvival?: number;
  isHighlander?: boolean;
  achievements?: string[];
  llmProviderId?: string | null;
  llmRole?: OrchestratorRole;
  archetype?: AgentArchetype;
  lastDecisionReason?: string;
  allies?: string[];  // agent IDs of allied agents (max 3, mutual)
}

export interface SpatialMemoryEntry {
  type: 'food' | 'water' | 'wood' | 'stone' | 'danger' | 'iron';
  x: number;
  y: number;
  tick: number;  // when remembered
}

// --- Player Messages ---

export interface PlayerMessage {
  id: string;
  fromPlayer: string;
  toAgent: string;
  content: string;
  timestamp: number;
  cost: number;
  followed: boolean | null; // null = not yet decided
}

// --- Social ---

export interface SocialInteraction {
  agentA: string;
  agentB: string;
  type: 'greeting' | 'trade' | 'help' | 'conflict' | 'conversation';
  outcome: number; // -10 to +10 relationship change
  timestamp: number;
}

// --- Trees ---

export interface TreeState {
  id: string;
  x: number;         // top-left tile x of the 2x2 base
  y: number;         // top-left tile y of the 2x2 base
  type: 0 | 1;       // tree variant (visual)
  health: number;     // remaining wood resource
  maxHealth: number;
  isStump: boolean;
  stumpAge: number;   // ticks since becoming stump
  growthStage: number;  // 0=sprout (1x1), 1=young (1x1), 2=mature (2x2)
  growthTicks: number;  // ticks since current stage began
}

// --- Rocks ---

export interface RockState {
  id: string;
  x: number;
  y: number;
  type: 0 | 1;       // 0 = small rock (grass/dirt, 20 stone), 1 = big rock (dirt only, 100 stone)
  health: number;     // remaining stone resource
  maxHealth: number;
  isRubble: boolean;
  rubbleAge: number;  // ticks since becoming rubble
}

// --- Growth Stages ---

export const GrowthStage = {
  SPROUT: 0,    // just planted, tiny, not harvestable
  YOUNG: 1,     // growing, partially harvestable (30% health)
  MATURE: 2,    // fully grown, normal behavior
} as const;
export type GrowthStage = (typeof GrowthStage)[keyof typeof GrowthStage];

// --- Plants ---

export const PlantType = {
  MUSHROOM: 0,       // edible mushroom — food
  POISON_SHROOM: 1,  // poisonous mushroom — drains health
  FLOWER: 2,         // healing flower — restores health
  STAMINA_HERB: 3,   // restores stamina
  HUNGER_HERB: 4,    // helps with hunger
  BERRY_BUSH: 5,     // main food source, 30 food, 90% seed drop
  EDIBLE_FLOWER: 6,  // mild food + visual variety — ~10 hunger
} as const;
export type PlantType = (typeof PlantType)[keyof typeof PlantType];

export interface PlantState {
  id: string;
  x: number;
  y: number;
  type: PlantType;
  health: number;     // resource remaining (bush=30, single-use=1)
  maxHealth: number;
  growthStage: number;  // 0=sprout, 1=young, 2=mature
  growthTicks: number;  // ticks since current stage began
}

// --- Animals ---

export type AnimalAction =
  | 'idle'
  | 'wandering'
  | 'grazing'
  | 'hunting'
  | 'fleeing'
  | 'fighting'
  | 'drinking'
  | 'sleeping'
  | 'traveling'
  | 'dying'
  | 'breeding'
  | 'stalking'
  | 'following'
  | 'guarding'
  | 'curled';

export interface AnimalState {
  id: string;
  species: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  proteinHunger: number;  // 0-100 (was: hunger)
  plantHunger: number;    // 0-100
  thirst: number;       // 0-100
  stamina: number;      // 0-100
  baseStats: BaseStats;
  skills: SkillSet;
  action: AnimalAction;
  actionTimer: number;
  target?: { x: number; y: number };
  targetEntityId?: string;
  homeX: number;
  homeY: number;
  alive: boolean;
  age: number;
  frame: 0 | 1;
  // Breeding
  breedCooldown: number;       // ticks until can breed again
  // Taming
  tamed: boolean;
  tamedBy?: string;            // agent ID
  tamingProgress: number;      // 0 to species tamingCost
  // Drops
  foodDrop: number;          // meat yielded on death
  drops?: Partial<DropTable>;
  // Pack
  packId?: string;
  // Spatial memory (unified with agents)
  spatialMemory?: SpatialMemoryEntry[];
  // Legacy memory fields (deprecated — use spatialMemory)
  lastFoodX?: number;
  lastFoodY?: number;
  lastFoodTick?: number;
  lastWaterX?: number;
  lastWaterY?: number;
  lastWaterTick?: number;
  lastDangerX?: number;
  lastDangerY?: number;
  lastDangerTick?: number;
  lastAttackedBy?: { type: 'animal' | 'agent'; id: string; tick: number };
  attackCooldown: number;         // ticks until next attack allowed
  lastDecisionReason?: string;
}


export interface AnimalSpecies {
  id: string;
  name: string;
  sprite: string;
  size: 'tiny' | 'small' | 'medium' | 'large';
  tier: 'apex' | 'mid_predator' | 'large_herb' | 'medium_herb' | 'small_prey';
  diet: 'carnivore' | 'herbivore' | 'omnivore';
  habitat: string[];
  speed: number;
  health: number;
  attack: number;
  detectionRange: number;
  hunts: string[];
  fleeThreshold: number;
  maxPopulation: number;
  foodDrop: number;
  hungerDecay: number;
  thirstDecay: number;
  staminaDecay: number;
  utilityWeights: {
    food: number;
    water: number;
    safety: number;
    aggression: number;
  };
  // Breeding
  breedCooldown: number;         // ticks between breeding
  litterSize: [number, number];  // [min, max] offspring
  // Taming
  tameable: boolean;
  tamingCost: number;            // food feedings needed
  tamingProximity: number;       // ticks of proximity needed (0 = not needed)
  tamedBehavior: 'follow' | 'guard' | 'produce' | 'passive';
  // Activity
  activity: 'diurnal' | 'nocturnal' | 'crepuscular';
  // Social
  social: 'solitary' | 'pair' | 'pack' | 'herd' | 'flock' | 'swarm';
  packSize: [number, number];    // [min, max] group size
  // Special
  specialAbility?: string;       // 'ambush' | 'curl' | 'howl' | 'trample' | 'seed_disperse' | 'peace_aura' | 'steal_food' | 'egg_laying'
  eggRate?: number;              // ticks between eggs (chicken/duck)
  // Steering
  flockingWeights?: {
    separation: number;
    alignment: number;
    cohesion: number;
  };
  fearedBy: string[];
  drops: Partial<DropTable>;
  isScavenger: boolean;
}

// --- Materials ---

export type MaterialType = 'meat' | 'bone' | 'hide' | 'sinew' | 'fat' | 'feathers' | 'teeth_claws' | 'scales';

export interface DropTable {
  meat: number;
  bone: number;
  hide: number;
  sinew: number;
  fat: number;
  feathers: number;
  teeth_claws: number;
  scales: number;
}

export interface CorpseState {
  id: string;
  x: number;
  y: number;
  sourceType: 'agent' | 'animal';
  sourceSpecies?: string;
  sourceName?: string;
  materials: Partial<DropTable>;
  carriedResources?: Partial<Resources>;
  createdAt: number;
  decayAt: number;  // createdAt + 600
}

// --- Crafting ---

export interface CraftingRecipe {
  name: string;
  requires: Partial<Resources>;
  produces: TileType;
  skillRequired: number;
}

export const RECIPES: CraftingRecipe[] = [
  { name: 'Wooden Floor', requires: { wood: 3 }, produces: TileType.BUILT_FLOOR, skillRequired: 0 },
  { name: 'Wooden Wall', requires: { wood: 5 }, produces: TileType.BUILT_WALL, skillRequired: 3 },
  { name: 'Campfire', requires: { wood: 3, stone: 2 }, produces: TileType.CAMPFIRE, skillRequired: 5 },
  { name: 'Workbench', requires: { wood: 8, stone: 4 }, produces: TileType.WORKBENCH, skillRequired: 10 },
];

// --- Items & Inventory ---

export type ItemCategory = 'tool' | 'weapon' | 'armor' | 'accessory' | 'food' | 'material' | 'structure';
export type EquipSlot = 'mainHand' | 'body' | 'accessory';

export interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  weight: number;
  stackable: boolean;
  maxStack: number;
  equipSlot?: EquipSlot;
  durability?: number;
  // Combat
  attackBonus?: number;
  defenseBonus?: number;
  range?: number;
  // Tool bonuses (multipliers)
  woodcuttingBonus?: number;
  miningBonus?: number;
  harvestBonus?: number;
  // Utility
  carryCapacityBonus?: number;
  speedBonus?: number;
  socialBonus?: number;
  // Food
  nutrition?: {
    protein: number;
    plant: number;
    thirst?: number;
    health?: number;
    stamina?: number;
  };
  spoilsAfter?: number;
}

export interface InventoryItem {
  itemId: string;
  quantity: number;
  durability?: number;
  createdAt?: number;
}

export interface Equipment {
  mainHand?: InventoryItem;
  body?: InventoryItem;
  accessory?: InventoryItem;
}

export interface Inventory {
  items: InventoryItem[];
  equipped: Equipment;
}

// --- Structures ---

export interface StructureState {
  id: string;
  tileType: TileType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ownerId?: string;
  storedItems?: InventoryItem[];  // for STORAGE type
  lastMaintained: number;         // tick when last maintained (for decay)
}

// --- Network Events ---

export interface ServerToClientEvents {
  'world:init': (data: { tiles: number[][]; agents: AgentState[]; trees: TreeState[]; rocks: RockState[]; plants: PlantState[]; animals: AnimalState[]; corpses: CorpseState[]; structures: StructureState[] }) => void;
  'world:update': (data: { agents: AgentState[]; changedTiles: { x: number; y: number; type: TileType }[]; trees: TreeState[]; rocks: RockState[]; plants: PlantState[]; animals: AnimalState[]; corpses: CorpseState[]; structures: StructureState[]; season?: Season }) => void;
  'agent:died': (data: { agentId: string; name: string; cause: string }) => void;
  'agent:born': (data: { agent: AgentState }) => void;
  'agent:permadeath': (data: { agentId: string; name: string; achievements: string[] }) => void;
  'agent:llm_action': (data: { agentId: string; role: OrchestratorRole; actionType: string; details: string }) => void;
  'agent:plan_update': (data: { agentId: string; planName: string; currentStep: number; totalSteps: number; status: string }) => void;
  'game:results': (data: GameResults) => void;
  'social:interaction': (data: SocialInteraction) => void;
  'message:result': (data: { messageId: string; followed: boolean; reason: string }) => void;
  'world:event': (data: { type: string; message: string; x?: number; y?: number }) => void;
}

export interface ClientToServerEvents {
  'player:join': (data: { playerId: string; name: string }) => void;
  'player:create_agent': (data: { name: string; personality: PersonalityTrait[] }) => void;
  'player:message': (data: { agentId: string; content: string }) => void;
  'player:camera': (data: { x: number; y: number }) => void;
  'game:configure': (config: GameConfig) => void;
  'agent:assign_llm': (data: { agentId: string; providerId: string; role: OrchestratorRole }) => void;
  'agent:remove_llm': (data: { agentId: string }) => void;
  'game:stop': () => void;
}

// --- Utility ---

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

const FIRST_NAMES = [
  'Ada', 'Bjorn', 'Celia', 'Dax', 'Elena', 'Finn', 'Greta', 'Hugo',
  'Iris', 'Jin', 'Kara', 'Leo', 'Mira', 'Nico', 'Ora', 'Pike',
  'Quinn', 'Reva', 'Sol', 'Tova', 'Uri', 'Vera', 'Wren', 'Xan', 'Yara', 'Zev'
];

export function randomName(): string {
  return FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
}
