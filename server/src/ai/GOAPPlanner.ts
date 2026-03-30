import {
  AgentState, AgentAction, TileType, PlantType, distance, clamp
} from '../../shared/src/index.ts';
import type { BehaviorGenome } from '../../shared/src/index.ts';
import { World } from '../World.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';
import { getItemDef } from '../ItemDefinitions.ts';
import { createDefaultGenome } from './BehaviorGenome.ts';

// ============================================================
// GOAP — Goal-Oriented Action Planning
// ============================================================

// --- World State ---

export interface GOAPWorldState {
  // Agent resources
  wood: number;
  stone: number;
  meat: number;
  iron_ore: number;
  iron_ingot: number;
  food: number;
  bone: number;
  hide: number;
  sinew: number;
  fat: number;
  feathers: number;
  teeth_claws: number;

  // Agent needs (0-100)
  proteinHunger: number;
  plantHunger: number;
  thirst: number;
  stamina: number;
  health: number;
  shelter: number;
  social: number;

  // Agent capabilities
  buildingLevel: number;
  craftingLevel: number;
  combatLevel: number;
  hasCampfire: boolean;
  hasWorkbench: boolean;
  hasForge: boolean;

  // Equipment
  hasAxe: boolean;
  hasPickaxe: boolean;
  hasWeapon: boolean;

  // World knowledge
  nearbyWood: boolean;
  nearbyStone: boolean;
  nearbyWater: boolean;
  nearbyFood: boolean;
  nearbyPrey: boolean;
  nearbyAgent: boolean;
  nearbyIronOre: boolean;

  [key: string]: number | boolean;
}

// --- Goals ---

export interface GOAPGoal {
  id: string;
  name: string;
  conditions: Partial<GOAPWorldState>;
  urgency: (state: GOAPWorldState, agent: AgentState) => number;
  isRelevant: (state: GOAPWorldState, agent: AgentState) => boolean;
}

// --- Actions ---

export interface GOAPAction {
  id: string;
  name: string;
  preconditions: Partial<GOAPWorldState>;
  effects: Partial<GOAPWorldState>;
  cost: (state: GOAPWorldState, agent: AgentState) => number;
  estimatedTicks: number;
  agentAction: AgentAction;
  isValid: (state: GOAPWorldState, agent: AgentState, world: World) => boolean;
}

// --- Planner internals ---

interface PlanNode {
  unsatisfied: { key: string; required: number | boolean }[];
  actions: GOAPAction[];
  cost: number;
  state: GOAPWorldState;
}

// --- Utility curves ---

function quadratic(x: number): number {
  const clamped = clamp(x, 0, 1);
  return clamped * clamped;
}

function linear(x: number): number {
  return clamp(x, 0, 1);
}

// ============================================================
// Build world state snapshot from agent perspective
// ============================================================

function isAdjacentToTile(x: number, y: number, tileType: TileType, world: World): boolean {
  const dirs = [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
  return dirs.some(({ dx, dy }) => world.getTile(x + dx, y + dy) === tileType);
}

export function buildWorldState(agent: AgentState, world: World, allAgents: AgentState[]): GOAPWorldState {
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);
  const SCAN_RANGE = 15;

  // Check equipment
  let hasAxe = false;
  let hasPickaxe = false;
  let hasWeapon = false;

  const checkItem = (item: { itemId: string } | undefined) => {
    if (!item) return;
    const def = getItemDef(item.itemId);
    if (def.woodcuttingBonus && def.woodcuttingBonus > 0) hasAxe = true;
    if (def.miningBonus && def.miningBonus > 0) hasPickaxe = true;
    if (def.attackBonus && def.attackBonus > 0) hasWeapon = true;
  };

  checkItem(agent.inventory.equipped.mainHand);
  for (const item of agent.inventory.items) {
    checkItem(item);
  }

  // Check nearby resources
  const nearbyWood = world.findNearestTree(ax, ay, SCAN_RANGE) !== null;
  const nearbyStone = world.findNearestRock(ax, ay, SCAN_RANGE) !== null;
  const nearbyWater = world.findNearest(ax, ay, TileType.WATER, SCAN_RANGE) !== null;
  const nearbyFood = world.findNearestPlant(ax, ay,
    [PlantType.BERRY_BUSH, PlantType.MUSHROOM, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER],
    SCAN_RANGE) !== null;
  const nearbyPrey = world.animals.some(
    a => a.alive && distance(agent.x, agent.y, a.x, a.y) < SCAN_RANGE
      && (getSpecies(a.species).foodDrop > 0 || (getSpecies(a.species).drops?.meat ?? 0) > 0)
  );
  const nearbyAgent = allAgents.some(
    a => a.id !== agent.id && a.alive && distance(agent.x, agent.y, a.x, a.y) < SCAN_RANGE
  );
  const nearbyIronOre = world.findNearest(ax, ay, TileType.IRON_ORE, SCAN_RANGE) !== null;

  return {
    wood: agent.resources.wood,
    stone: agent.resources.stone,
    meat: agent.resources.meat,
    iron_ore: agent.resources.iron_ore,
    iron_ingot: agent.resources.iron_ingot,
    food: agent.resources.food,
    bone: agent.resources.bone,
    hide: agent.resources.hide,
    sinew: agent.resources.sinew,
    fat: agent.resources.fat,
    feathers: agent.resources.feathers,
    teeth_claws: agent.resources.teeth_claws,

    proteinHunger: agent.needs.proteinHunger,
    plantHunger: agent.needs.plantHunger,
    thirst: agent.needs.thirst,
    stamina: agent.needs.stamina,
    health: agent.needs.health,
    shelter: agent.needs.shelter,
    social: agent.needs.social,

    buildingLevel: agent.skills.building.level,
    craftingLevel: agent.skills.crafting.level,
    combatLevel: agent.skills.combat.level,
    hasCampfire: isAdjacentToTile(ax, ay, TileType.CAMPFIRE, world)
      || world.findNearest(ax, ay, TileType.CAMPFIRE, 10) !== null,
    hasWorkbench: isAdjacentToTile(ax, ay, TileType.WORKBENCH, world)
      || world.findNearest(ax, ay, TileType.WORKBENCH, 10) !== null,
    hasForge: isAdjacentToTile(ax, ay, TileType.FORGE, world)
      || world.findNearest(ax, ay, TileType.FORGE, 10) !== null,

    hasAxe,
    hasPickaxe,
    hasWeapon,

    nearbyWood,
    nearbyStone,
    nearbyWater,
    nearbyFood,
    nearbyPrey,
    nearbyAgent,
    nearbyIronOre,
  };
}

// ============================================================
// Goal Definitions
// ============================================================

export const GOAP_GOALS: GOAPGoal[] = [
  {
    id: 'survive_thirst',
    name: 'Drink water',
    conditions: { thirst: 80 },
    urgency: (s) => quadratic(1 - s.thirst / 100),
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.thirst < g.goalThresholds.thirstRelevant;
    },
  },
  {
    id: 'survive_protein',
    name: 'Eat protein',
    conditions: { proteinHunger: 80 },
    urgency: (s) => quadratic(1 - s.proteinHunger / 100),
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.proteinHunger < g.goalThresholds.proteinRelevant;
    },
  },
  {
    id: 'survive_plant',
    name: 'Eat plants',
    conditions: { plantHunger: 80 },
    urgency: (s) => quadratic(1 - s.plantHunger / 100),
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.plantHunger < g.goalThresholds.plantRelevant;
    },
  },
  {
    id: 'rest',
    name: 'Rest',
    conditions: { stamina: 80 },
    urgency: (s) => quadratic(1 - s.stamina / 100),
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.stamina < g.goalThresholds.staminaRelevant;
    },
  },
  {
    id: 'get_shelter',
    name: 'Build shelter',
    conditions: { shelter: 60 },
    urgency: (s) => linear(1 - s.shelter / 100) * 0.6,
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.shelter < g.goalThresholds.shelterRelevant;
    },
  },
  {
    id: 'get_equipped',
    name: 'Craft tools',
    conditions: { hasAxe: true, hasPickaxe: true },
    urgency: (s) => s.hasAxe && s.hasPickaxe ? 0 : 0.3,
    isRelevant: (s) => !s.hasAxe || !s.hasPickaxe,
  },
  {
    id: 'socialize',
    name: 'Talk to someone',
    conditions: { social: 70 },
    urgency: (s) => linear(1 - s.social / 100) * 0.4,
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.social < g.goalThresholds.socialRelevant;
    },
  },
  {
    id: 'stockpile_wood',
    name: 'Gather wood',
    conditions: { wood: 15 },
    urgency: (s) => s.wood < 5 ? 0.35 : 0.15,
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.wood < g.goalThresholds.woodTarget;
    },
  },
  {
    id: 'stockpile_stone',
    name: 'Gather stone',
    conditions: { stone: 8 },
    urgency: (s) => s.stone < 3 ? 0.3 : 0.1,
    isRelevant: (s, agent) => {
      const g = ((agent as any).currentGenome as BehaviorGenome | undefined) ?? createDefaultGenome();
      return s.stone < g.goalThresholds.stoneTarget;
    },
  },
  {
    id: 'cook_food',
    name: 'Cook food',
    conditions: { food: 5 },
    urgency: (s) => s.meat > 2 && s.hasCampfire ? 0.35 : 0,
    isRelevant: (s) => s.meat > 2,
  },
];

// ============================================================
// Action Definitions
// ============================================================

export const GOAP_ACTIONS: GOAPAction[] = [
  // --- Gathering ---
  {
    id: 'chop_wood',
    name: 'Chop tree',
    preconditions: { nearbyWood: true },
    effects: { wood: 5 },
    cost: (s, a) => 10 / (1 + a.skills.woodcutting.level * 0.01),
    estimatedTicks: 30,
    agentAction: 'harvesting',
    isValid: (s) => s.nearbyWood,
  },
  {
    id: 'mine_stone',
    name: 'Mine rock',
    preconditions: { nearbyStone: true },
    effects: { stone: 3 },
    cost: (s, a) => 12 / (1 + a.skills.mining.level * 0.01),
    estimatedTicks: 25,
    agentAction: 'harvesting',
    isValid: (s) => s.nearbyStone,
  },
  {
    id: 'forage_plants',
    name: 'Gather berries/herbs',
    preconditions: { nearbyFood: true },
    effects: { plantHunger: 15 },
    cost: () => 8,
    estimatedTicks: 15,
    agentAction: 'harvesting',
    isValid: (s) => s.nearbyFood,
  },
  {
    id: 'hunt_animal',
    name: 'Hunt animal',
    preconditions: { nearbyPrey: true, hasWeapon: true },
    effects: { meat: 5, proteinHunger: 25 },
    cost: (s, a) => 20 / (1 + a.skills.combat.level * 0.01),
    estimatedTicks: 60,
    agentAction: 'harvesting',
    isValid: (s) => s.nearbyPrey && s.hasWeapon,
  },
  {
    id: 'hunt_unarmed',
    name: 'Hunt (bare hands)',
    preconditions: { nearbyPrey: true },
    effects: { meat: 3, proteinHunger: 15 },
    cost: (s, a) => 30 / (1 + a.skills.combat.level * 0.01),
    estimatedTicks: 80,
    agentAction: 'harvesting',
    isValid: (s) => s.nearbyPrey,
  },
  {
    id: 'mine_iron',
    name: 'Mine iron ore',
    preconditions: { nearbyIronOre: true, hasPickaxe: true },
    effects: { iron_ore: 2 },
    cost: () => 15,
    estimatedTicks: 40,
    agentAction: 'harvesting',
    isValid: (s) => s.nearbyIronOre && s.hasPickaxe,
  },

  // --- Consuming ---
  {
    id: 'drink_water',
    name: 'Drink water',
    preconditions: { nearbyWater: true },
    effects: { thirst: 30 },
    cost: () => 5,
    estimatedTicks: 10,
    agentAction: 'drinking',
    isValid: (s) => s.nearbyWater,
  },
  {
    id: 'eat_food',
    name: 'Eat from inventory',
    preconditions: {},
    effects: { proteinHunger: 12, plantHunger: 12 },
    cost: () => 3,
    estimatedTicks: 5,
    agentAction: 'eating',
    isValid: (s) => s.food > 0 || s.meat > 0,
  },
  {
    id: 'rest',
    name: 'Rest',
    preconditions: {},
    effects: { stamina: 30 },
    cost: () => 15,
    estimatedTicks: 50,
    agentAction: 'resting',
    isValid: () => true,
  },

  // --- Building ---
  {
    id: 'build_campfire',
    name: 'Build campfire',
    preconditions: { wood: 3, stone: 2 },
    effects: { hasCampfire: true },
    cost: () => 8,
    estimatedTicks: 10,
    agentAction: 'building',
    isValid: (s) => s.wood >= 3 && s.stone >= 2 && s.buildingLevel >= 5,
  },
  {
    id: 'build_workbench',
    name: 'Build workbench',
    preconditions: { wood: 8, stone: 4 },
    effects: { hasWorkbench: true },
    cost: () => 12,
    estimatedTicks: 15,
    agentAction: 'building',
    isValid: (s) => s.wood >= 8 && s.stone >= 4 && s.buildingLevel >= 10,
  },
  {
    id: 'build_wall',
    name: 'Build wall',
    preconditions: { wood: 5, hasWorkbench: true },
    effects: { shelter: 20 },
    cost: (s, a) => 10 / (1 + a.skills.building.level * 0.01),
    estimatedTicks: 15,
    agentAction: 'building',
    isValid: (s) => s.wood >= 5 && s.buildingLevel >= 3,
  },
  {
    id: 'build_forge',
    name: 'Build forge',
    preconditions: { stone: 12, wood: 8, hasWorkbench: true },
    effects: { hasForge: true },
    cost: () => 20,
    estimatedTicks: 20,
    agentAction: 'building',
    isValid: (s) => s.stone >= 12 && s.wood >= 8 && s.buildingLevel >= 15,
  },

  // --- Crafting ---
  {
    id: 'craft_stone_axe',
    name: 'Craft stone axe',
    preconditions: { wood: 2, stone: 3, hasWorkbench: true },
    effects: { hasAxe: true },
    cost: () => 10,
    estimatedTicks: 20,
    agentAction: 'crafting',
    isValid: (s) => s.wood >= 2 && s.stone >= 3,
  },
  {
    id: 'craft_stone_pickaxe',
    name: 'Craft stone pickaxe',
    preconditions: { wood: 2, stone: 3, hasWorkbench: true },
    effects: { hasPickaxe: true },
    cost: () => 10,
    estimatedTicks: 20,
    agentAction: 'crafting',
    isValid: (s) => s.wood >= 2 && s.stone >= 3,
  },
  {
    id: 'craft_weapon',
    name: 'Craft weapon',
    preconditions: { wood: 5, hasWorkbench: true },
    effects: { hasWeapon: true },
    cost: () => 12,
    estimatedTicks: 25,
    agentAction: 'crafting',
    isValid: (s) => s.wood >= 5,
  },
  {
    id: 'cook_meat',
    name: 'Cook meat',
    preconditions: { meat: 2, hasCampfire: true },
    effects: { proteinHunger: 20, food: 1 },
    cost: () => 6,
    estimatedTicks: 15,
    agentAction: 'crafting',
    isValid: (s) => s.meat >= 2,
  },
  {
    id: 'smelt_iron',
    name: 'Smelt iron',
    preconditions: { iron_ore: 2, wood: 2, hasForge: true },
    effects: { iron_ingot: 1 },
    cost: () => 15,
    estimatedTicks: 30,
    agentAction: 'crafting',
    isValid: (s) => s.iron_ore >= 2 && s.wood >= 2,
  },

  // --- Social ---
  {
    id: 'socialize',
    name: 'Talk to nearby agent',
    preconditions: { nearbyAgent: true },
    effects: { social: 10 },
    cost: () => 5,
    estimatedTicks: 20,
    agentAction: 'socializing',
    isValid: (s) => s.nearbyAgent,
  },
];

// ============================================================
// Personality Cost Modifiers
// ============================================================

function adjustCostForPersonality(baseCost: number, action: GOAPAction, agent: AgentState): number {
  let cost = baseCost;

  if (agent.personality.includes('industrious')) {
    if (['chop_wood', 'mine_stone', 'build_wall', 'build_workbench'].includes(action.id)) {
      cost *= 0.7;
    }
  }

  if (agent.personality.includes('lazy')) {
    if (['chop_wood', 'mine_stone', 'hunt_animal'].includes(action.id)) {
      cost *= 1.5;
    }
    if (['eat_food', 'rest'].includes(action.id)) {
      cost *= 0.8;
    }
  }

  if (agent.personality.includes('social')) {
    if (action.id === 'socialize') cost *= 0.5;
  }

  if (agent.personality.includes('loner')) {
    if (action.id === 'socialize') cost *= 2.0;
  }

  return cost;
}

// ============================================================
// Planner Helpers
// ============================================================

function meetsCondition(state: GOAPWorldState, key: string, required: number | boolean): boolean {
  const current = state[key];
  if (typeof required === 'boolean') {
    return current === required;
  }
  // For numeric conditions: current value must be >= required
  return (current as number) >= required;
}

function getUnsatisfied(
  conditions: Partial<GOAPWorldState>,
  state: GOAPWorldState
): { key: string; required: number | boolean }[] {
  const result: { key: string; required: number | boolean }[] = [];
  for (const [key, required] of Object.entries(conditions)) {
    if (required === undefined) continue;
    if (!meetsCondition(state, key, required)) {
      result.push({ key, required });
    }
  }
  return result;
}

function applyEffects(state: GOAPWorldState, effects: Partial<GOAPWorldState>): GOAPWorldState {
  const newState = { ...state };
  for (const [key, value] of Object.entries(effects)) {
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      (newState as any)[key] = value;
    } else {
      // Numeric effects are additive (the value in effects represents the gain)
      (newState as any)[key] = (newState[key] as number) + value;
    }
  }
  return newState;
}

function deduplicateConditions(
  conditions: { key: string; required: number | boolean }[]
): { key: string; required: number | boolean }[] {
  const map = new Map<string, number | boolean>();
  for (const cond of conditions) {
    const existing = map.get(cond.key);
    if (existing === undefined) {
      map.set(cond.key, cond.required);
    } else if (typeof cond.required === 'number' && typeof existing === 'number') {
      // Keep the higher requirement
      map.set(cond.key, Math.max(existing, cond.required));
    }
    // For booleans, first entry wins (they should be the same)
  }
  return Array.from(map.entries()).map(([key, required]) => ({ key, required }));
}

// ============================================================
// Backward-Chaining A* Planner
// ============================================================

const MAX_DEPTH = 6;
const MAX_ITERATIONS = 50;

export function planGOAP(
  agent: AgentState,
  world: World,
  currentState: GOAPWorldState,
  goal: GOAPGoal,
  actions: GOAPAction[],
  maxDepth: number = MAX_DEPTH,
  maxIterations: number = MAX_ITERATIONS
): GOAPAction[] | null {
  const planGenome: BehaviorGenome = (agent as any).currentGenome ?? createDefaultGenome();
  const openSet: PlanNode[] = [];
  let iterations = 0;

  const startNode: PlanNode = {
    unsatisfied: getUnsatisfied(goal.conditions, currentState),
    actions: [],
    cost: 0,
    state: { ...currentState },
  };

  // Goal already satisfied
  if (startNode.unsatisfied.length === 0) return null;

  openSet.push(startNode);

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Pick lowest-cost node
    openSet.sort((a, b) => a.cost - b.cost);
    const node = openSet.shift()!;

    // All conditions satisfied
    if (node.unsatisfied.length === 0) {
      return node.actions.reverse(); // backward chain → reverse for execution order
    }

    // Max depth reached
    if (node.actions.length >= maxDepth) continue;

    // Try each action
    for (const action of actions) {
      if (!action.isValid(node.state, agent, world)) continue;

      // Does this action satisfy at least one unsatisfied condition?
      const satisfies = node.unsatisfied.some(cond => {
        const effect = action.effects[cond.key];
        return effect !== undefined;
      });
      if (!satisfies) continue;

      // Apply action effects to simulated state
      const newState = applyEffects(node.state, action.effects);
      const newUnsatisfied = getUnsatisfied(goal.conditions, newState);

      // Add action preconditions as new requirements
      for (const [key, val] of Object.entries(action.preconditions)) {
        if (val === undefined) continue;
        if (!meetsCondition(currentState, key, val)) {
          newUnsatisfied.push({ key, required: val });
        }
      }

      const deduped = deduplicateConditions(newUnsatisfied);

      const baseCost = action.cost(currentState, agent);
      let adjustedCost = adjustCostForPersonality(baseCost, action, agent);
      adjustedCost *= planGenome.actionCostMods[action.id] ?? 1.0;

      const newNode: PlanNode = {
        unsatisfied: deduped,
        actions: [...node.actions, action],
        cost: node.cost + adjustedCost,
        state: newState,
      };

      openSet.push(newNode);
    }
  }

  return null; // no plan found
}

// ============================================================
// Goal Selection
// ============================================================

export function selectGoal(agent: AgentState, state: GOAPWorldState): GOAPGoal | null {
  const genome: BehaviorGenome = (agent as any).currentGenome ?? createDefaultGenome();
  let bestGoal: GOAPGoal | null = null;
  let bestUrgency = 0;

  for (const goal of GOAP_GOALS) {
    if (!goal.isRelevant(state, agent)) continue;
    const baseUrgency = goal.urgency(state, agent);
    const weight = genome.goalWeights[goal.id] ?? 1.0;
    const weightedUrgency = baseUrgency * weight;
    if (weightedUrgency > bestUrgency) {
      bestUrgency = weightedUrgency;
      bestGoal = goal;
    }
  }

  return bestGoal;
}

// ============================================================
// Plan Invalidation
// ============================================================

export function planInvalidated(
  plan: GOAPAction[],
  state: GOAPWorldState,
  agent: AgentState,
  world: World,
  tickCount: number,
  planCreatedAt: number
): boolean {
  if (plan.length === 0) return true;

  // Check next action's preconditions and validity
  const next = plan[0];
  for (const [key, val] of Object.entries(next.preconditions)) {
    if (val === undefined) continue;
    if (!meetsCondition(state, key, val)) return true;
  }
  if (!next.isValid(state, agent, world)) return true;

  // Plan too old (world changed too much)
  if (tickCount - planCreatedAt > 600) return true;

  return false;
}

// ============================================================
// Action Completion Check
// ============================================================

export function actionComplete(
  action: GOAPAction,
  state: GOAPWorldState
): boolean {
  // Check if the action's effects are already reflected in the current state
  // relative to the goal — i.e., the action has achieved what it was supposed to
  for (const [key, value] of Object.entries(action.effects)) {
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      if (state[key] !== value) return false;
    }
    // For numeric effects, we consider the action complete if we've been
    // executing it long enough (tracked externally via tick count)
  }
  return true;
}

// ============================================================
// Serializable plan step for client UI
// ============================================================

export interface GOAPPlanStep {
  actionId: string;
  actionName: string;
}

export function serializePlan(plan: GOAPAction[]): GOAPPlanStep[] {
  return plan.map(a => ({ actionId: a.id, actionName: a.name }));
}
