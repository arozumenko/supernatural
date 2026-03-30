import {
  AgentState, AgentAction, TileType, PlantType, AnimalState, InventoryItem, SpatialMemoryEntry, clamp, distance,
  BehaviorGenome
} from '../../shared/src/index.ts';
import { World } from '../World.ts';
import { findPath } from './Pathfinding.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';
import { awardXP, getNeedDecayReduction, getHitAccuracy, getAttackDamage, getHarvestSpeedBonus, getAgentSpeed, getAnimalDefense, getDodgeChance, canIdentifyPoison } from '../Progression.ts';
import { RECIPES as NEW_RECIPES } from '../RecipeDefinitions.ts';
import { getItemDef } from '../ItemDefinitions.ts';
import {
  GOAPAction, buildWorldState, selectGoal, planGOAP, planInvalidated,
  GOAP_ACTIONS, serializePlan
} from './GOAPPlanner.ts';
import { createDefaultGenome } from './BehaviorGenome.ts';
import { executePendingPlan } from '../api/plan-executor.ts';
import { evaluateStrategyRules } from './StrategyRules.ts';

// Base decay rates per tick (level 0 agent)
const HUNGER_DECAY = 0.15;
const THIRST_DECAY = 0.2;
const STAMINA_DECAY = 0.05;
const SOCIAL_DECAY = 0.03;
const SHELTER_DECAY = 0.02;

// How much actions restore (flat — doesn't scale with level)
const EAT_RESTORE = 25;
const DRINK_RESTORE = 30;
const REST_RESTORE = 15;
const SOCIAL_RESTORE = 10;

// --- Metabolism scaling ---
// Higher-level agents burn through resources faster.
// Sum of all skill levels determines metabolism: a maxed agent (990 total) eats/drinks ~3x more.
// Activity multiplier: heavy actions (chopping, mining, fighting) burn even more.
const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  idle: 0.6,
  resting: 0.4,
  wandering: 1.0,
  socializing: 0.8,
  building: 1.4,
  crafting: 1.2,
  harvesting: 1.5,
  hunting: 1.6,
  fighting: 1.8,
  fleeing: 1.3,
};

function getTotalSkillLevels(agent: AgentState): number {
  const s = agent.skills;
  return s.combat.level + s.defense.level + s.athletics.level
    + s.woodcutting.level + s.mining.level + s.foraging.level
    + s.building.level + s.crafting.level + s.survival.level + s.social.level;
}

function getMetabolismMultiplier(agent: AgentState): number {
  // Level scaling: 1.0 at level 0, ~2.0 at 500 total levels, ~2.98 at 990
  const levelMod = 1 + getTotalSkillLevels(agent) / 500;
  // Activity scaling: heavy work burns more
  const activityMod = ACTIVITY_MULTIPLIERS[agent.action] ?? 1.0;
  return levelMod * activityMod;
}

interface Decision {
  action: AgentAction;
  priority: number;
  target?: { x: number; y: number };
  targetTreeId?: string;
  targetRockId?: string;
  targetPlantId?: string;
  targetAnimalId?: string;
  targetCorpseId?: string;
  reason: string;
}

// --- GOAP plan storage (server-side, keyed by agent ID) ---
// The actual GOAPAction[] plans live here; AgentState only carries serialized steps for UI.
const agentPlans = new Map<string, {
  plan: GOAPAction[];
  goalId: string;
  createdAt: number;
  stepIndex: number;
  stepStartTick: number;  // tick when the current step started executing
}>();

// Re-plan staggering: track which agent index re-planned last
let lastReplanIndex = 0;

// Async planning: agents currently waiting for microtask plan result
const pendingPlans = new Set<string>();

function isAdjacentToTile(x: number, y: number, tileType: TileType, world: World): boolean {
  const dirs = [{dx:0,dy:0},{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  return dirs.some(({dx,dy}) => world.getTile(x+dx, y+dy) === tileType);
}

// --- Spatial Memory ---
const MAX_MEMORIES = 20;
const MEMORY_EXPIRY = 3000; // 5 minutes at 10 tps

function rememberLocation(agent: AgentState, type: SpatialMemoryEntry['type'], x: number, y: number, tick: number): void {
  if (!agent.spatialMemory) agent.spatialMemory = [];
  // Don't duplicate nearby memories of same type
  const existing = agent.spatialMemory.find(m => m.type === type && Math.abs(m.x - x) < 3 && Math.abs(m.y - y) < 3);
  if (existing) {
    existing.tick = tick;
    return;
  }
  agent.spatialMemory.push({ type, x, y, tick });
  // Evict oldest if over limit
  if (agent.spatialMemory.length > MAX_MEMORIES) {
    agent.spatialMemory.sort((a, b) => b.tick - a.tick);
    agent.spatialMemory.length = MAX_MEMORIES;
  }
}

function recallLocation(agent: AgentState, type: SpatialMemoryEntry['type'], tick: number): { x: number; y: number } | null {
  if (!agent.spatialMemory) return null;
  // Expire old memories
  agent.spatialMemory = agent.spatialMemory.filter(m => tick - m.tick < MEMORY_EXPIRY);
  // Find closest remembered location of this type
  let best: SpatialMemoryEntry | null = null;
  let bestDist = Infinity;
  for (const m of agent.spatialMemory) {
    if (m.type !== type) continue;
    const d = distance(agent.x, agent.y, m.x, m.y);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  return best ? { x: best.x, y: best.y } : null;
}

// ============================================================
// GOAP Decision Layer
// ============================================================

function goapActionToDecision(
  action: GOAPAction,
  agent: AgentState,
  world: World,
  allAgents: AgentState[]
): Decision | null {
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);

  switch (action.id) {
    case 'chop_wood': {
      const tree = world.findNearestTree(ax, ay);
      if (!tree) return null;
      const adj = world.findNearestWalkable(ax, ay, tree.x, tree.y);
      return { action: 'harvesting', priority: 50, target: adj, targetTreeId: tree.id, reason: `GOAP: ${action.name}` };
    }
    case 'mine_stone': {
      const rock = world.findNearestRock(ax, ay);
      if (!rock) return null;
      const adj = world.findNearestWalkable(ax, ay, rock.x, rock.y);
      return { action: 'harvesting', priority: 50, target: adj, targetRockId: rock.id, reason: `GOAP: ${action.name}` };
    }
    case 'forage_plants': {
      const foodTypes = [PlantType.BERRY_BUSH, PlantType.MUSHROOM, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER];
      const plant = world.findNearestPlant(ax, ay, foodTypes);
      if (!plant) return null;
      return { action: 'harvesting', priority: 50, target: { x: plant.x, y: plant.y }, targetPlantId: plant.id, reason: `GOAP: ${action.name}` };
    }
    case 'hunt_animal':
    case 'hunt_unarmed': {
      let bestPrey: { id: string; x: number; y: number; dist: number } | null = null;
      for (const animal of world.animals) {
        if (!animal.alive) continue;
        const species = getSpecies(animal.species);
        const meatValue = species.drops?.meat ?? species.foodDrop ?? 0;
        if (meatValue === 0) continue;
        const d = distance(agent.x, agent.y, animal.x, animal.y);
        if (d < 15 && (!bestPrey || d < bestPrey.dist)) {
          bestPrey = { id: animal.id, x: Math.floor(animal.x), y: Math.floor(animal.y), dist: d };
        }
      }
      if (!bestPrey) return null;
      return { action: 'harvesting', priority: 50, target: { x: bestPrey.x, y: bestPrey.y }, targetAnimalId: bestPrey.id, reason: `GOAP: ${action.name}` };
    }
    case 'mine_iron': {
      const ironTile = world.findNearest(ax, ay, TileType.IRON_ORE, 20);
      if (!ironTile) return null;
      const adj = world.findNearestWalkable(ax, ay, ironTile.x, ironTile.y);
      return { action: 'harvesting', priority: 50, target: adj, reason: `GOAP: ${action.name}` };
    }
    case 'drink_water': {
      const water = world.findNearest(ax, ay, TileType.WATER);
      if (!water) return null;
      return { action: 'drinking', priority: 50, target: water, reason: `GOAP: ${action.name}` };
    }
    case 'eat_food':
      return { action: 'eating', priority: 50, reason: `GOAP: ${action.name}` };
    case 'rest':
      return { action: 'resting', priority: 50, reason: `GOAP: ${action.name}` };
    case 'build_campfire':
    case 'build_workbench':
    case 'build_wall':
    case 'build_forge':
      return { action: 'building', priority: 50, reason: `GOAP: ${action.name}` };
    case 'craft_stone_axe':
    case 'craft_stone_pickaxe':
    case 'craft_weapon':
    case 'cook_meat':
    case 'smelt_iron':
      return { action: 'crafting', priority: 50, reason: `GOAP: ${action.name}` };
    case 'socialize': {
      const nearbyAgent = allAgents.find(
        a => a.id !== agent.id && a.alive && distance(agent.x, agent.y, a.x, a.y) < 15
      );
      if (!nearbyAgent) return null;
      return {
        action: 'socializing', priority: 50,
        target: { x: Math.floor(nearbyAgent.x), y: Math.floor(nearbyAgent.y) },
        reason: `GOAP: ${action.name}`
      };
    }
    default:
      return null;
  }
}

/** Estimated ticks per action step; if exceeded, assume step is done or stuck */
const STEP_TIMEOUT_MULTIPLIER = 2.5;

function tryGOAPDecision(
  agent: AgentState,
  world: World,
  allAgents: AgentState[],
  tickCount: number,
  agentIndex: number,
  ax: number,
  ay: number
): Decision | null {
  const worldState = buildWorldState(agent, world, allAgents);
  let planData = agentPlans.get(agent.id);

  // Check if current plan needs invalidation
  if (planData) {
    const { plan, createdAt, stepIndex } = planData;
    if (plan.length === 0 || stepIndex >= plan.length
      || planInvalidated(plan.slice(stepIndex), worldState, agent, world, tickCount, createdAt)) {
      agentPlans.delete(agent.id);
      planData = undefined;
    }
  }

  // Check if current step timed out (stuck)
  if (planData) {
    const currentAction = planData.plan[planData.stepIndex];
    const elapsed = tickCount - planData.stepStartTick;
    if (elapsed > currentAction.estimatedTicks * STEP_TIMEOUT_MULTIPLIER) {
      // Step took too long — advance to next step or re-plan
      planData.stepIndex++;
      planData.stepStartTick = tickCount;
      if (planData.stepIndex >= planData.plan.length) {
        agentPlans.delete(agent.id);
        planData = undefined;
      }
    }
  }

  // Re-plan if needed — async via microtask (plan arrives next tick)
  if (!planData) {
    if (pendingPlans.has(agent.id)) {
      // Planning in progress — wait for async result, use fallback this tick
      return null;
    }
    // Stagger: allow re-planning for ~3 agents per tick
    if (agentIndex % Math.max(1, Math.ceil(allAgents.length / 3)) === tickCount % Math.max(1, Math.ceil(allAgents.length / 3))) {
      const goal = selectGoal(agent, worldState);
      if (goal) {
        // Queue planning as microtask — resolves between ticks
        pendingPlans.add(agent.id);
        const stateSnapshot = { ...worldState };
        const capturedTick = tickCount;
        Promise.resolve().then(() => {
          const plan = planGOAP(agent, world, stateSnapshot, goal, GOAP_ACTIONS);
          pendingPlans.delete(agent.id);
          if (plan && plan.length > 0) {
            agentPlans.set(agent.id, {
              plan,
              goalId: goal.id,
              createdAt: capturedTick,
              stepIndex: 0,
              stepStartTick: capturedTick,
            });
            // Update wire fields for UI
            agent.currentPlanGoal = goal.name;
            agent.currentPlanSteps = plan.map(a => ({ actionId: a.id, actionName: a.name }));
            agent.planStepIndex = 0;
          }
        });
        return null; // no plan yet this tick, use fallback
      }
    }
  }

  // No plan available
  if (!planData) {
    // Clear UI state
    agent.currentPlanGoal = undefined;
    agent.currentPlanSteps = undefined;
    agent.planStepIndex = undefined;
    return null;
  }

  // Execute current plan step
  const currentAction = planData.plan[planData.stepIndex];

  // Check if current step's effects are already achieved (step complete)
  let stepDone = true;
  for (const [key, value] of Object.entries(currentAction.effects)) {
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      if (worldState[key] !== value) { stepDone = false; break; }
    } else {
      // For numeric resource effects — check if the agent has gained enough
      // We consider the step done if the preconditions of the NEXT step are met,
      // or if the effect target is achieved
    }
  }

  // For action types that are "one-shot" (eating, building, crafting, resting, drinking),
  // advance after a minimum number of ticks
  const elapsed = tickCount - planData.stepStartTick;
  const isOneShot = ['eat_food', 'drink_water', 'rest', 'build_campfire', 'build_workbench',
    'build_wall', 'build_forge', 'craft_stone_axe', 'craft_stone_pickaxe',
    'craft_weapon', 'cook_meat', 'smelt_iron', 'socialize'].includes(currentAction.id);

  if (isOneShot && elapsed >= currentAction.estimatedTicks) {
    // One-shot complete, advance
    planData.stepIndex++;
    planData.stepStartTick = tickCount;
    if (planData.stepIndex >= planData.plan.length) {
      agentPlans.delete(agent.id);
      agent.currentPlanGoal = undefined;
      agent.currentPlanSteps = undefined;
      agent.planStepIndex = undefined;
      return null; // plan complete, fall through to fallback or idle
    }
  }

  // For gathering actions: check if we got what we needed
  if (!isOneShot && elapsed > 5) {
    const gatherActions = ['chop_wood', 'mine_stone', 'forage_plants', 'hunt_animal', 'hunt_unarmed', 'mine_iron'];
    if (gatherActions.includes(currentAction.id)) {
      // Check if all effects from this action are now met relative to the goal
      let allEffectsMet = true;
      for (const [key, value] of Object.entries(currentAction.effects)) {
        if (value === undefined) continue;
        if (typeof value === 'boolean') {
          if (worldState[key] !== value) { allEffectsMet = false; break; }
        }
        // For numeric: check if we have enough for the next step's preconditions
        // or for the overall goal
      }
      // Simpler heuristic: if we've been gathering for estimatedTicks, advance
      if (elapsed >= currentAction.estimatedTicks) {
        planData.stepIndex++;
        planData.stepStartTick = tickCount;
        if (planData.stepIndex >= planData.plan.length) {
          agentPlans.delete(agent.id);
          agent.currentPlanGoal = undefined;
          agent.currentPlanSteps = undefined;
          agent.planStepIndex = undefined;
          return null;
        }
      }
    }
  }

  // Update UI state
  const goalDef = selectGoal(agent, worldState);
  agent.currentPlanGoal = planData.goalId;
  agent.currentPlanSteps = serializePlan(planData.plan);
  agent.planStepIndex = planData.stepIndex;

  // Convert current GOAP action to NeedsSystem Decision
  const currentStep = planData.plan[planData.stepIndex];
  const decision = goapActionToDecision(currentStep, agent, world, allAgents);
  if (!decision) {
    // Can't execute this step — invalidate plan
    agentPlans.delete(agent.id);
    agent.currentPlanGoal = undefined;
    agent.currentPlanSteps = undefined;
    agent.planStepIndex = undefined;
    return null;
  }

  return decision;
}

export function decayNeeds(agent: AgentState): void {
  if (!agent.alive) return;

  const survivalReduction = 1 - getNeedDecayReduction(agent.skills);
  const metabolism = getMetabolismMultiplier(agent);

  // Hunger & thirst scale with metabolism (level + activity)
  agent.needs.proteinHunger = clamp(agent.needs.proteinHunger - HUNGER_DECAY * 0.6 * survivalReduction * metabolism, 0, 100);
  agent.needs.plantHunger = clamp(agent.needs.plantHunger - HUNGER_DECAY * 0.6 * survivalReduction * metabolism, 0, 100);
  agent.needs.thirst = clamp(agent.needs.thirst - THIRST_DECAY * survivalReduction * metabolism, 0, 100);

  // Stamina: per-action costs with skill-based reduction
  if (agent.action === 'resting') {
    const restEfficiency = 1 / (1 + getTotalSkillLevels(agent) / 800);
    agent.needs.stamina = clamp(agent.needs.stamina + REST_RESTORE * 0.1 * restEfficiency, 0, 100);
  } else {
    const actionStaminaCosts: Record<string, { base: number; skill?: keyof typeof agent.skills }> = {
      idle: { base: 0.02 },
      wandering: { base: 0.04, skill: 'athletics' },
      moving_to: { base: 0.05, skill: 'athletics' },
      harvesting: { base: 0.08, skill: 'woodcutting' },  // generic; real skill varies by target
      eating: { base: 0.01 },
      drinking: { base: 0.01 },
      building: { base: 0.07, skill: 'building' },
      crafting: { base: 0.05, skill: 'crafting' },
      socializing: { base: 0.02, skill: 'social' },
      trading: { base: 0.02 },
      planting: { base: 0.04, skill: 'foraging' },
      following_message: { base: 0.04 },
    };
    const costDef = actionStaminaCosts[agent.action] ?? { base: STAMINA_DECAY };
    const skillReduction = costDef.skill ? agent.skills[costDef.skill].level * 0.002 : 0;
    const staminaDrain = costDef.base * (1 - skillReduction) * metabolism;
    agent.needs.stamina = clamp(agent.needs.stamina - staminaDrain, 0, 100);
  }

  agent.needs.social = clamp(agent.needs.social - SOCIAL_DECAY, 0, 100);
  agent.needs.shelter = clamp(agent.needs.shelter - SHELTER_DECAY, 0, 100);

  // Health damage from critical needs (awards defense XP for enduring damage)
  const proteinEmpty = agent.needs.proteinHunger <= 0;
  const plantEmpty = agent.needs.plantHunger <= 0;
  let envDamage = 0;
  if (proteinEmpty && plantEmpty) {
    envDamage += 1.5;
    agent.needs.health = clamp(agent.needs.health - 1.5, 0, 100);
  } else if (proteinEmpty || plantEmpty) {
    envDamage += 0.5;
    agent.needs.health = clamp(agent.needs.health - 0.5, 0, 100);
  }
  if (agent.needs.thirst <= 0) {
    envDamage += 1.5;  // was 0.8 — dehydration kills faster
    agent.needs.health = clamp(agent.needs.health - 1.5, 0, 100);
  }
  if (agent.needs.stamina <= 0) {
    envDamage += 0.1;
    agent.needs.health = clamp(agent.needs.health - 0.1, 0, 100);
  }
  // Exposure damage: no shelter slowly drains health
  if (agent.needs.shelter <= 0) {
    envDamage += 0.15;
    agent.needs.health = clamp(agent.needs.health - 0.15, 0, 100);
  }
  // Environmental damage awards survival XP, not defense (defense = combat blocking)
  if (envDamage > 0) {
    awardXP(agent.skills, 'survival', 0.2, envDamage);
  }

  // Slow health regen when needs are met — scales with survival level
  if (agent.needs.proteinHunger > 50 && agent.needs.plantHunger > 50 && agent.needs.thirst > 50 && agent.needs.stamina > 30) {
    const survivalRegen = 0.01 * agent.skills.survival.level; // 0 at level 0, ~1 at level 99
    agent.needs.health = clamp(agent.needs.health + Math.max(0.05, survivalRegen), 0, 100);
  }

  // Skill-driven passive bonuses
  // Athletics: faster stamina recovery when resting
  if (agent.action === 'resting') {
    agent.needs.stamina = clamp(agent.needs.stamina + agent.skills.athletics.level * 0.02, 0, 100);
  }
  // Endurance (base stat): slower hunger/thirst decay
  const enduranceReduction = agent.baseStats.endurance * 0.003; // max ~4.5% at 15 END
  agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + HUNGER_DECAY * enduranceReduction, 0, 100);
  agent.needs.thirst = clamp(agent.needs.thirst + THIRST_DECAY * enduranceReduction, 0, 100);
  // Toughness (base stat): slow passive regen — only when not taking environmental damage
  if (agent.needs.health < 100 && envDamage === 0) {
    agent.needs.health = clamp(agent.needs.health + agent.baseStats.toughness * 0.002, 0, 100);
  }

  // Award survival XP when struggling
  const lowestNeed = Math.min(agent.needs.proteinHunger, agent.needs.plantHunger, agent.needs.thirst, agent.needs.stamina);
  if (lowestNeed < 30) {
    awardXP(agent.skills, 'survival', 0.3, (100 - lowestNeed) / 50);
  }

  // Decrement attack cooldown
  if (agent.attackCooldown > 0) {
    agent.attackCooldown--;
  }

  // Death check
  if (agent.needs.health <= 0) {
    agent.alive = false;
    agent.action = 'dying';
  }

  agent.age++;
}

export function decideAction(agent: AgentState, world: World, allAgents: AgentState[], tickCount: number = 0, agentIndex: number = 0, continueCurrentAction: boolean = false): Decision {
  if (!agent.alive) return { action: 'dying', priority: 0, reason: 'dead' };

  const genome: BehaviorGenome = (agent as any).currentGenome ?? createDefaultGenome();

  const decisions: Decision[] = [];
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);

  // --- Check for player messages ---
  if (agent.messageQueue.length > 0) {
    const msg = agent.messageQueue[0];
    // Social skill increases effective obedience (up to +20 at level 99)
    const effectiveObedience = clamp(agent.obedience + agent.skills.social.level * 0.2, 0, 100);
    const willFollow = Math.random() * 100 < effectiveObedience;
    if (willFollow) {
      // Parse simple commands from message
      const cmd = parsePlayerCommand(msg.content);
      if (cmd) {
        decisions.push({
          action: cmd.action,
          priority: 85 + (agent.obedience / 10),
          target: cmd.target,
          reason: `following player message: "${msg.content}"`
        });
      }
    }
    // Mark message as processed
    msg.followed = willFollow;
    agent.lastMessage = agent.messageQueue.shift()!;
  }

  // --- Evaluate threats from all nearby animals ---
  for (const animal of world.animals) {
    if (!animal.alive) continue;
    const species = getSpecies(animal.species);

    // Only consider animals that actually hunt agents as threats
    const huntsAgents = species.hunts?.includes('agent') ?? false;
    const isActivelyAttacking = animal.action === 'hunting' || animal.action === 'fighting';
    const wasAttacker = agent.lastAttackedBy?.type === 'animal' && agent.lastAttackedBy.id === animal.id;
    if (!huntsAgents && !isActivelyAttacking && !wasAttacker) continue;

    const dist = distance(agent.x, agent.y, animal.x, animal.y);

    // Perception-based detection range
    const detectRange = genome.thresholds.threatDetectBase + (agent.skills.survival.level * 0.1);

    // Sound detection for large moving predators
    const sizeNum = species.size === 'large' ? 4 : species.size === 'medium' ? 3 : species.size === 'small' ? 2 : 1;
    const noise = sizeNum * (animal.action === 'hunting' ? 0.5 : 0.3);
    const soundRange = 8 * noise;

    if (dist > detectRange && dist > soundRange) continue;

    // Evaluate danger: compare animal's attack to agent's total power
    const agentDefense = 10 + agent.skills.defense.level * 0.5;
    const agentAttack = agent.baseStats.strength + agent.skills.combat.level * 0.3;
    const equipBonus = (agent.inventory.equipped.mainHand ? 5 : 0) + (agent.inventory.equipped.body ? 5 : 0);
    const totalSkills = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);

    // Confidence: higher level = less afraid. Reduced when injured.
    const healthFactor = agent.needs.health > 60 ? 1.0 : agent.needs.health / 60; // confidence drops when hurt
    const confidence = Math.min(1.5, (0.5 + (totalSkills / 100) + (agentAttack / 20) + (equipBonus / 20)) * healthFactor);
    const dangerRatio = species.attack / Math.max(1, agentDefense * confidence);

    // Confident agents ignore weak threats — but never when health is low
    if (agent.needs.health > 50 && dangerRatio < 0.4 * confidence) continue;

    // Was recently attacked by this animal?
    const wasAttacked = agent.lastAttackedBy?.type === 'animal' && agent.lastAttackedBy.id === animal.id;

    const proximityUrgency = 1 - (dist / Math.max(detectRange, soundRange));
    // Confidence reduces flee urgency — powerful agents stand their ground more
    let fleePriority = Math.floor(genome.interruptWeights.fleeBase + (dangerRatio * proximityUrgency * 35) - (confidence * 10));
    // Desperate agents don't flee as readily — they'll fight for survival
    const desperation = (agent.needs.proteinHunger < 15 || agent.needs.thirst < 15) ? 25 : 0;
    fleePriority -= desperation;
    if (wasAttacked) fleePriority = Math.min(fleePriority + 20, 98);

    if (fleePriority > 60) {
      const fleeX = Math.floor(agent.x + (agent.x - animal.x) * 2);
      const fleeY = Math.floor(agent.y + (agent.y - animal.y) * 2);
      // Remember danger location
      rememberLocation(agent, 'danger', Math.floor(animal.x), Math.floor(animal.y), agent.age);
      decisions.push({
        action: 'wandering',
        priority: clamp(fleePriority, 60, 98),
        target: { x: fleeX, y: fleeY },
        reason: `threatened by ${species.name}`
      });
      break; // Only flee from the most dangerous threat
    }
  }

  // --- Self-defense: fight back against current attacker ---
  if (agent.lastAttackedBy?.type === 'animal') {
    const attacker = world.animals.find(a => a.id === agent.lastAttackedBy!.id && a.alive);
    if (attacker) {
      const distToAttacker = distance(agent.x, agent.y, attacker.x, attacker.y);
      if (distToAttacker < 3) {
        const attackerSpecies = getSpecies(attacker.species);
        let weaponBonus = 0;
        const weapon = agent.inventory.equipped.mainHand;
        if (weapon) {
          const weaponDef = getItemDef(weapon.itemId);
          weaponBonus = weaponDef.attackBonus || 0;
        }
        const myAttack = 10 + agent.skills.combat.level * 0.5 + weaponBonus;
        const desperate = agent.needs.health < 30 || agent.needs.proteinHunger < 15;
        // Fight back if strong enough OR if desperate (nothing to lose)
        if (desperate || myAttack > attackerSpecies.attack * genome.thresholds.fightBackMinRatio) {
          decisions.push({
            action: 'harvesting',
            priority: genome.interruptWeights.fightBack,
            target: { x: Math.floor(attacker.x), y: Math.floor(attacker.y) },
            targetAnimalId: attacker.id,
            reason: desperate ? 'fighting back (desperate)' : 'fighting back against attacker'
          });
        }
      }
    }
  }

  // --- Group defense: help nearby ally under attack ---
  if (!agent.lastAttackedBy) {
    for (const ally of allAgents) {
      if (ally.id === agent.id || !ally.alive) continue;
      if (!ally.lastAttackedBy || ally.lastAttackedBy.type !== 'animal') continue;
      const allyDist = distance(agent.x, agent.y, ally.x, ally.y);
      if (allyDist > genome.thresholds.groupDefenseRange) continue; // only help nearby allies
      const attacker = world.animals.find(a => a.id === ally.lastAttackedBy!.id && a.alive);
      if (!attacker) continue;
      const distToAttacker = distance(agent.x, agent.y, attacker.x, attacker.y);
      if (distToAttacker < 10) {
        decisions.push({
          action: 'harvesting',
          priority: genome.interruptWeights.groupDefense,
          target: { x: Math.floor(attacker.x), y: Math.floor(attacker.y) },
          targetAnimalId: attacker.id,
          reason: `defending ${ally.name}`
        });
        break; // only help one ally at a time
      }
    }
  }

  // --- Critical survival ---
  if (agent.needs.thirst < genome.thresholds.criticalThirst) {
    // Critical: search wider radius for water (60 tiles, not default 20)
    const water = world.findNearest(ax, ay, TileType.WATER, 60)
      ?? recallLocation(agent, 'water', agent.age);
    if (water) {
      decisions.push({
        action: 'drinking',
        priority: genome.interruptWeights.criticalThirst,
        target: water,
        reason: 'critically thirsty'
      });
    } else {
      // No water found — desperately search: wander in a random direction
      const searchX = ax + (Math.random() > 0.5 ? 15 : -15);
      const searchY = ay + (Math.random() > 0.5 ? 15 : -15);
      decisions.push({
        action: 'wandering',
        priority: genome.interruptWeights.criticalThirst - 5,
        target: { x: searchX, y: searchY },
        reason: 'searching for water (desperate)'
      });
    }
  }

  const effectiveHunger = Math.min(agent.needs.proteinHunger, agent.needs.plantHunger);

  if (effectiveHunger < genome.thresholds.criticalHunger) {
    // Try eating from inventory first
    if (agent.resources.food > 0) {
      decisions.push({ action: 'eating', priority: genome.interruptWeights.criticalHunger, reason: 'eating from inventory' });
    } else {
      // Look for food plants — low survival skill may confuse poison shrooms for edible ones
      const foodTypes: PlantType[] = [PlantType.BERRY_BUSH, PlantType.MUSHROOM, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER];
      if (!canIdentifyPoison(agent.skills) && Math.random() < 0.3) {
        foodTypes.push(PlantType.POISON_SHROOM);
      }
      const foodPlant = world.findNearestPlant(ax, ay, foodTypes);
      if (foodPlant) {
        decisions.push({
          action: 'harvesting',
          priority: genome.interruptWeights.criticalHunger,
          target: { x: foodPlant.x, y: foodPlant.y },
          targetPlantId: foodPlant.id,
          reason: 'foraging for food'
        });
      } else {
        // No food anywhere — desperately search
        const searchX = ax + (Math.random() > 0.5 ? 15 : -15);
        const searchY = ay + (Math.random() > 0.5 ? 15 : -15);
        decisions.push({
          action: 'wandering',
          priority: genome.interruptWeights.criticalHunger - 5,
          target: { x: searchX, y: searchY },
          reason: 'searching for food (desperate)'
        });
      }
    }
  }

  // --- Health recovery from flowers ---
  if (agent.needs.health < genome.thresholds.moderateHealth) {
    const flower = world.findNearestPlant(ax, ay, [PlantType.FLOWER]);
    if (flower) {
      decisions.push({
        action: 'harvesting',
        priority: agent.needs.health < genome.thresholds.criticalHealth ? genome.interruptWeights.lowHealth : 50,
        target: { x: flower.x, y: flower.y },
        targetPlantId: flower.id,
        reason: 'seeking healing flower'
      });
    }
  }

  if (agent.needs.stamina < genome.thresholds.criticalStamina) {
    // Check for stamina herb — only if close enough (walking drains more stamina)
    const herb = world.findNearestPlant(ax, ay, [PlantType.STAMINA_HERB], 5);
    if (herb) {
      decisions.push({
        action: 'harvesting',
        priority: genome.interruptWeights.staminaHerb,
        target: { x: herb.x, y: herb.y },
        targetPlantId: herb.id,
        reason: 'seeking stamina herb'
      });
    }
    // Rest is always available and slightly higher priority than distant herb
    decisions.push({ action: 'resting', priority: genome.interruptWeights.exhaustionRest + 3, reason: 'exhausted, must rest' });
  }

  // === Action Commitment ===
  // If we're continuing the current action (non-decision tick), only allow critical interrupts (priority >= 85).
  // This prevents flickering between goals every tick.
  if (continueCurrentAction && agent.action !== 'idle' && agent.action !== 'wandering') {
    const criticalInterrupt = decisions.find(d => d.priority >= 80);
    if (criticalInterrupt) {
      agentPlans.delete(agent.id);
      agent.currentPlanGoal = undefined;
      agent.currentPlanSteps = undefined;
      agent.planStepIndex = undefined;
      return criticalInterrupt;
    }

    // Stuck detection: if agent hasn't moved in 30 ticks, force re-evaluation
    const lastX = (agent as any)._lastPosX ?? agent.x;
    const lastY = (agent as any)._lastPosY ?? agent.y;
    const stuckTicks = (agent as any)._stuckTicks ?? 0;
    if (Math.abs(agent.x - lastX) < 0.1 && Math.abs(agent.y - lastY) < 0.1) {
      (agent as any)._stuckTicks = stuckTicks + 1;
    } else {
      (agent as any)._stuckTicks = 0;
    }
    (agent as any)._lastPosX = agent.x;
    (agent as any)._lastPosY = agent.y;

    if ((agent as any)._stuckTicks >= 30) {
      // Been stuck for 3 seconds — force full re-evaluation
      (agent as any)._stuckTicks = 0;
      // Fall through to full decision logic below
    } else {
      // Continue current action
      const currentTarget = agent.actionTarget;
      return {
        action: agent.action,
        priority: 50,
        target: currentTarget,
        reason: 'continuing current action'
      };
    }
  }

  // === GOAP Layer ===
  // Only critical interrupts (>= 80) skip GOAP and kill active plans.
  // Medium priorities (60-79) compete with GOAP but don't destroy plans.
  const criticalInterrupt = decisions.find(d => d.priority >= 80);
  if (criticalInterrupt) {
    // Critical interrupt overrides everything — clear active plan
    agentPlans.delete(agent.id);
    agent.currentPlanGoal = undefined;
    agent.currentPlanSteps = undefined;
    agent.planStepIndex = undefined;
    return criticalInterrupt;
  }

  // API Plan: execute pending plan (between interrupts and GOAP)
  const planDecision = executePendingPlan(agent, world, tickCount);
  if (planDecision) {
    decisions.push(planDecision as any);
    // If plan priority is high enough, use it directly
    if (planDecision.priority >= 60) {
      agent.lastDecisionReason = planDecision.reason;
      return planDecision as any;
    }
  }

  // GOAP: try to follow or create a plan
  const goapDecision = tryGOAPDecision(agent, world, allAgents, tickCount, agentIndex, ax, ay);
  if (goapDecision) {
    return goapDecision;
  }

  // === Fallback: original priority system (medium priority and below) ===
  // Only reached if GOAP couldn't produce a plan.

  // --- Medium priority ---
  if (agent.needs.thirst < genome.goalThresholds.thirstRelevant) {
    const water = world.findNearest(ax, ay, TileType.WATER, 40)
      ?? recallLocation(agent, 'water', agent.age);
    if (water) {
      decisions.push({ action: 'drinking', priority: genome.mediumPriorityWeights.drinkMedium, target: water, reason: 'getting thirsty' });
    } else {
      // Can't find water — wander to search
      const rx = ax + Math.floor(Math.random() * 40) - 20;
      const ry = ay + Math.floor(Math.random() * 40) - 20;
      decisions.push({ action: 'wandering', priority: genome.mediumPriorityWeights.drinkMedium - 10,
        target: { x: rx, y: ry }, reason: 'searching for water' });
    }
  }

  if (effectiveHunger < genome.goalThresholds.proteinRelevant) {
    if (agent.resources.food > 0) {
      decisions.push({ action: 'eating', priority: genome.mediumPriorityWeights.eatMedium, reason: 'having a snack' });
    } else {
      const medFoodTypes: PlantType[] = [PlantType.BERRY_BUSH, PlantType.MUSHROOM, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER];
      if (!canIdentifyPoison(agent.skills) && Math.random() < 0.2) {
        medFoodTypes.push(PlantType.POISON_SHROOM);
      }
      const foodPlant = world.findNearestPlant(ax, ay, medFoodTypes);
      if (foodPlant) {
        decisions.push({
          action: 'harvesting',
          priority: genome.mediumPriorityWeights.eatMedium,
          target: { x: foodPlant.x, y: foodPlant.y },
          targetPlantId: foodPlant.id,
          reason: 'gathering food'
        });
      }
    }
  }

  // --- Gathering bonuses ---
  const isIndustrious = agent.personality.includes('industrious');
  const gatherBonus = isIndustrious ? 15 : 0;

  // --- Hunt animals for food — utility-scored risk/reward ---
  // Desperate mode: when starving, hunt at much higher priority and accept more risk
  const isStarving = agent.needs.proteinHunger < 15;
  if (agent.needs.proteinHunger < genome.goalThresholds.proteinRelevant) {
    for (const animal of world.animals) {
      if (!animal.alive) continue;
      const species = getSpecies(animal.species);
      const dist = distance(agent.x, agent.y, animal.x, animal.y);
      if (dist > genome.thresholds.huntDetectRange) continue;

      const meatValue = species.drops?.meat ?? species.foodDrop ?? 0;
      if (meatValue === 0) continue;

      const myAttack = 10 + agent.skills.combat.level * 0.5;
      const riskScore = species.attack / Math.max(1, myAttack);
      const rewardScore = meatValue / 15;
      const hungerUrgency = 1 - (agent.needs.proteinHunger / 100);

      // Starving agents fight anything — even bears — to survive
      if (!isStarving && riskScore > 1.5 && hungerUrgency < 0.7) continue;

      const huntBase = genome.fallbackWeights.huntAnimal - 10;
      let huntPriority = Math.floor(huntBase + (rewardScore * hungerUrgency * 30) - (riskScore * 10));

      // Starvation boost: hunt priority spikes when truly desperate
      if (isStarving) {
        huntPriority = Math.max(huntPriority, 75); // at least as urgent as flee
      }

      if (huntPriority > huntBase) {
        decisions.push({
          action: 'harvesting',
          priority: huntPriority + gatherBonus,
          target: { x: Math.floor(animal.x), y: Math.floor(animal.y) },
          targetAnimalId: animal.id,
          reason: isStarving ? `desperate hunt: ${species.name}` : `hunting ${species.name}`
        });
        break; // only target closest viable prey
      }
    }
  }

  // --- Harvest nearby corpses for materials/meat ---
  if (agent.needs.proteinHunger < genome.goalThresholds.proteinRelevant || agent.resources.meat < genome.thresholds.meatMinimum) {
    const corpse = world.findNearestCorpse(ax, ay, genome.thresholds.corpseDetectRange);
    if (corpse) {
      decisions.push({
        action: 'harvesting',
        priority: genome.fallbackWeights.harvestCorpse,
        target: { x: Math.floor(corpse.x), y: Math.floor(corpse.y) },
        targetCorpseId: corpse.id,
        reason: 'harvesting corpse'
      });
    }
  }

  // --- Stamina herb when moderately tired ---
  if (agent.needs.stamina < genome.thresholds.criticalStamina + 20) {
    const herb = world.findNearestPlant(ax, ay, [PlantType.STAMINA_HERB]);
    if (herb) {
      decisions.push({
        action: 'harvesting',
        priority: 45,
        target: { x: herb.x, y: herb.y },
        targetPlantId: herb.id,
        reason: 'looking for stamina herb'
      });
    }
  }

  // --- Gathering resources ---
  if (agent.resources.wood < genome.thresholds.woodMinimum) {
    const tree = world.findNearestTree(ax, ay);
    if (tree) {
      const adj = world.findNearestWalkable(ax, ay, tree.x, tree.y);
      decisions.push({
        action: 'harvesting',
        priority: genome.fallbackWeights.gatherWood + gatherBonus,
        target: adj,
        targetTreeId: tree.id,
        reason: 'gathering wood'
      });
    } else {
      // Use spatial memory to find remembered wood location
      const remembered = recallLocation(agent, 'wood', agent.age);
      if (remembered) {
        decisions.push({
          action: 'wandering',
          priority: genome.fallbackWeights.gatherWood - 10 + gatherBonus,
          target: remembered,
          reason: 'heading to remembered trees'
        });
      }
    }
  }

  if (agent.resources.stone < genome.thresholds.stoneMinimum) {
    const rock = world.findNearestRock(ax, ay);
    if (rock) {
      const adj = world.findNearestWalkable(ax, ay, rock.x, rock.y);
      decisions.push({
        action: 'harvesting',
        priority: genome.fallbackWeights.mineStone + gatherBonus,
        target: adj,
        targetRockId: rock.id,
        reason: 'mining stone'
      });
    } else {
      const remembered = recallLocation(agent, 'stone', agent.age);
      if (remembered) {
        decisions.push({
          action: 'wandering',
          priority: genome.fallbackWeights.mineStone - 8 + gatherBonus,
          target: remembered,
          reason: 'heading to remembered rocks'
        });
      }
    }
  }

  // --- Building ---
  // Only decide to build if agent meets the skill requirement and no duplicate station nearby
  if (agent.needs.shelter < genome.goalThresholds.shelterRelevant && agent.resources.wood >= 3) {
    const canBuild = NEW_RECIPES.some(r => {
      if (r.skillType !== 'building' || r.produces.type !== 'tile') return false;
      if (agent.skills.building.level < r.skillRequired) return false;
      // Don't build workbench/forge duplicates within 5 tiles (but campfire is always OK)
      const pt = r.produces.tileType as TileType;
      if ((pt === TileType.WORKBENCH || pt === TileType.FORGE)
        && world.findNearest(ax, ay, pt, 5) !== null) return false;
      if (r.station === 'workbench' && !isAdjacentToTile(ax, ay, TileType.WORKBENCH, world)) return false;
      if (r.station === 'forge' && !isAdjacentToTile(ax, ay, TileType.FORGE, world)) return false;
      return Object.entries(r.requires).every(([res, amt]) => ((agent.resources as any)[res] || 0) >= amt);
    });
    if (canBuild) {
      // Higher priority when shelter is critically low
      const shelterUrgency = agent.needs.shelter < 15 ? 20 : agent.needs.shelter < 30 ? 10 : 0;
      decisions.push({
        action: 'building',
        priority: 45 + (agent.skills.building.level / 5) + shelterUrgency,
        target: { x: ax, y: ay }, // build at current position
        reason: 'needs shelter'
      });
    }
  }

  // --- Crafting decisions (new recipe system) ---
  {
    const nearWorkbenchD = isAdjacentToTile(ax, ay, TileType.WORKBENCH, world);
    const nearCampfireD = isAdjacentToTile(ax, ay, TileType.CAMPFIRE, world);
    const nearForgeD = isAdjacentToTile(ax, ay, TileType.FORGE, world);

    if (nearWorkbenchD || nearCampfireD || nearForgeD) {
      for (const recipe of NEW_RECIPES) {
        const skillLevel = recipe.skillType === 'crafting' ? agent.skills.crafting.level : agent.skills.building.level;
        if (skillLevel < recipe.skillRequired) continue;
        if (recipe.station === 'campfire' && !nearCampfireD) continue;
        if (recipe.station === 'workbench' && !nearWorkbenchD) continue;
        if (recipe.station === 'forge' && !nearForgeD) continue;

        let canCraft = true;
        for (const [mat, qty] of Object.entries(recipe.requires)) {
          if (((agent.resources as any)[mat] || 0) < qty) { canCraft = false; break; }
        }
        if (!canCraft) continue;

        // Prioritize food crafting when hungry
        const isFoodRecipe = recipe.produces.type === 'item' && recipe.produces.itemId
          ? (getItemDef(recipe.produces.itemId).nutrition ? true : false)
          : false;
        const craftPriority = isFoodRecipe ? genome.fallbackWeights.craft + 23 : genome.fallbackWeights.craft;

        decisions.push({
          action: 'crafting',
          priority: craftPriority,
          reason: `crafting ${recipe.name}`
        });
        break; // only add one crafting decision
      }
    }
  }

  // --- Mine iron ore if agent has an iron pickaxe ---
  if (agent.resources.iron_ore < genome.thresholds.ironOreMinimum) {
    const ironTool = agent.inventory.equipped.mainHand;
    const hasIronPick = ironTool?.itemId === 'iron_pickaxe'
      || agent.inventory.items.some(i => i.itemId === 'iron_pickaxe');
    if (hasIronPick) {
      const ironTile = world.findNearest(ax, ay, TileType.IRON_ORE, genome.thresholds.ironDetectRange);
      if (ironTile) {
        const adj = world.findNearestWalkable(ax, ay, ironTile.x, ironTile.y);
        decisions.push({
          action: 'harvesting',
          priority: genome.fallbackWeights.mineIron + gatherBonus,
          target: adj,
          reason: 'mining iron ore'
        });
      }
    }
  }

  // --- Planting ---
  if (agent.resources.treeSeed > 0 && agent.resources.wood > genome.thresholds.woodToKeepBeforePlanting) {
    decisions.push({
      action: 'planting',
      priority: genome.fallbackWeights.plantSeeds + gatherBonus,
      reason: 'planting a tree seed'
    });
  }
  if (agent.resources.plantSeed > 0 && effectiveHunger < genome.thresholds.plantHungerTrigger) {
    decisions.push({
      action: 'planting',
      priority: genome.fallbackWeights.plantSeeds + 5 + gatherBonus,
      reason: 'planting a food plant'
    });
  }

  // --- Social ---
  const isSocial = agent.personality.includes('social');
  const socialBonus = isSocial ? 20 : 0;

  if (agent.needs.social < genome.goalThresholds.socialRelevant) {
    // Look nearby first
    const nearbyAgent = allAgents.find(
      a => a.id !== agent.id && a.alive && distance(agent.x, agent.y, a.x, a.y) < genome.thresholds.socialDetectRange
    );
    if (nearbyAgent) {
      decisions.push({
        action: 'socializing',
        priority: genome.fallbackWeights.socialize + socialBonus,
        target: { x: Math.floor(nearbyAgent.x), y: Math.floor(nearbyAgent.y) },
        reason: `wants to talk to ${nearbyAgent.name}`
      });
    } else {
      // No one nearby — find the closest agent anywhere and walk toward them
      let closestAgent: AgentState | null = null;
      let closestDist = Infinity;
      for (const a of allAgents) {
        if (a.id === agent.id || !a.alive) continue;
        const d = distance(agent.x, agent.y, a.x, a.y);
        if (d < closestDist) { closestDist = d; closestAgent = a; }
      }
      if (closestAgent) {
        decisions.push({
          action: 'wandering',
          priority: genome.fallbackWeights.socialize + socialBonus - 5,
          target: { x: Math.floor(closestAgent.x), y: Math.floor(closestAgent.y) },
          reason: `seeking company (${closestAgent.name})`
        });
      }
    }
  }

  // --- Taming nearby animals ---
  for (const animal of world.animals) {
    if (!animal.alive || animal.tamed) continue;
    const species = getSpecies(animal.species);
    if (!species.tameable) continue;
    const dist = distance(agent.x, agent.y, animal.x, animal.y);
    if (dist > 3) continue;
    if (agent.resources.food > 0 || agent.resources.meat > 0) {
      decisions.push({
        action: 'socializing',
        priority: genome.fallbackWeights.tameAnimal,
        target: { x: Math.floor(animal.x), y: Math.floor(animal.y) },
        targetAnimalId: animal.id,
        reason: `taming ${species.name}`
      });
      break;
    }
  }

  // --- Default: wander ---
  decisions.push({
    action: 'wandering',
    priority: genome.fallbackWeights.wander,
    reason: 'exploring'
  });

  // Apply strategy rules (LLM-evolved behavior modifiers)
  evaluateStrategyRules(agent, decisions as any, world, tickCount);

  // Pick highest priority
  decisions.sort((a, b) => b.priority - a.priority);
  const best = decisions[0];
  // Store decision reason + top competing decisions for debugging
  const topDec = decisions.slice(0, 4).map(d =>
    (d.action as string).slice(0, 6) + ':' + Math.floor(d.priority)
  ).join(' ');
  agent.lastDecisionReason = (best?.reason ?? best?.action ?? 'idle') + '\n' + topDec;
  return best;
}

function parsePlayerCommand(content: string): { action: AgentAction; target?: { x: number; y: number } } | null {
  const lower = content.toLowerCase();
  if (lower.includes('gather') || lower.includes('harvest') || lower.includes('chop') || lower.includes('mine')) {
    return { action: 'harvesting' };
  }
  if (lower.includes('build') || lower.includes('construct')) {
    return { action: 'building' };
  }
  if (lower.includes('eat') || lower.includes('food')) {
    return { action: 'eating' };
  }
  if (lower.includes('rest') || lower.includes('sleep')) {
    return { action: 'resting' };
  }
  if (lower.includes('talk') || lower.includes('socialize') || lower.includes('meet')) {
    return { action: 'socializing' };
  }
  if (lower.includes('explore') || lower.includes('wander') || lower.includes('move')) {
    return { action: 'wandering' };
  }
  if (lower.includes('plant') || lower.includes('seed') || lower.includes('grow')) {
    return { action: 'planting' };
  }
  if (lower.includes('tame') || lower.includes('feed animal')) {
    return { action: 'socializing' };
  }
  return null;
}

// Auto-equip best tool for the task
function autoEquipForTask(agent: AgentState, task: 'woodcutting' | 'mining' | 'harvest' | 'combat'): void {
  const bonusKey = task === 'woodcutting' ? 'woodcuttingBonus'
    : task === 'mining' ? 'miningBonus'
    : task === 'combat' ? 'attackBonus'
    : 'harvestBonus';

  let bestItem: InventoryItem | null = null;
  let bestBonus = 0;

  // Check current equipped
  const current = agent.inventory.equipped.mainHand;
  if (current) {
    const def = getItemDef(current.itemId);
    bestBonus = def[bonusKey] || 0;
    bestItem = current;
  }

  // Check inventory for better option
  for (const item of agent.inventory.items) {
    const def = getItemDef(item.itemId);
    if (def.equipSlot !== 'mainHand') continue;
    const bonus = def[bonusKey] || 0;
    if (bonus > bestBonus) {
      bestBonus = bonus;
      bestItem = item;
    }
  }

  // Swap if found better
  if (bestItem && bestItem !== current) {
    // Unequip current to inventory
    if (current) {
      agent.inventory.items.push(current);
    }
    // Remove from inventory and equip
    const idx = agent.inventory.items.indexOf(bestItem);
    if (idx !== -1) agent.inventory.items.splice(idx, 1);
    agent.inventory.equipped.mainHand = bestItem;
  }
}

export function executeAction(
  agent: AgentState,
  decision: Decision,
  world: World,
  allAgents: AgentState[]
): { tileChanges: { x: number; y: number; type: TileType }[]; interactions: any[] } {
  const tileChanges: { x: number; y: number; type: TileType }[] = [];
  const interactions: any[] = [];
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);

  // Guard: if action needs a target but has none, fall back to wandering
  const needsTarget = ['harvesting', 'drinking', 'building', 'crafting', 'socializing', 'planting', 'moving_to'];
  if (needsTarget.includes(decision.action) && !decision.target) {
    agent.action = 'wandering';
    agent.actionTarget = undefined;
    return { tileChanges, interactions };
  }

  agent.action = decision.action;
  agent.actionTarget = decision.target;

  switch (decision.action) {
    case 'eating': {
      // Diet-aware eating: meat → protein, food → plant, agents are omnivores
      if (agent.needs.proteinHunger < agent.needs.plantHunger && agent.resources.meat > 0) {
        agent.resources.meat -= 1;
        agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + EAT_RESTORE, 0, 100);
      } else if (agent.resources.food > 0) {
        agent.resources.food -= 1;
        agent.needs.plantHunger = clamp(agent.needs.plantHunger + EAT_RESTORE * 0.7, 0, 100);
        agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + EAT_RESTORE * 0.3, 0, 100);
      } else if (agent.resources.meat > 0) {
        agent.resources.meat -= 1;
        agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + EAT_RESTORE, 0, 100);
      } else {
        // Desperate: eat rotten meat from inventory (minor protein, health damage)
        const rottenIdx = agent.inventory.items.findIndex(i => i.itemId === 'rotten_meat');
        if (rottenIdx !== -1) {
          agent.inventory.items[rottenIdx].quantity--;
          if (agent.inventory.items[rottenIdx].quantity <= 0) agent.inventory.items.splice(rottenIdx, 1);
          agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + 5, 0, 100);
          agent.needs.health = clamp(agent.needs.health - 10, 0, 100);
          awardXP(agent.skills, 'defense', 0.5, 1.0);
        }
      }
      break;
    }

    case 'drinking': {
      if (decision.target) {
        const d = distance(agent.x, agent.y, decision.target.x, decision.target.y);
        if (d <= 2) {
          agent.needs.thirst = clamp(agent.needs.thirst + DRINK_RESTORE, 0, 100);
          rememberLocation(agent, 'water', decision.target.x, decision.target.y, agent.age);
        } else {
          moveTowards(agent, decision.target.x, decision.target.y, world);
        }
      }
      break;
    }

    case 'harvesting': {
      // Remember resource locations on successful harvest
      if (decision.target) {
        if (decision.targetTreeId) rememberLocation(agent, 'wood', decision.target.x, decision.target.y, agent.age);
        else if (decision.targetRockId) rememberLocation(agent, 'stone', decision.target.x, decision.target.y, agent.age);
        else if (decision.targetPlantId) rememberLocation(agent, 'food', decision.target.x, decision.target.y, agent.age);
      }
      // Auto-equip best tool for the task
      if (decision.targetTreeId) autoEquipForTask(agent, 'woodcutting');
      else if (decision.targetRockId) autoEquipForTask(agent, 'mining');
      else if (decision.targetAnimalId) autoEquipForTask(agent, 'combat');
      else autoEquipForTask(agent, 'harvest');

      if (decision.target) {
        const d = distance(agent.x, agent.y, decision.target.x, decision.target.y);
        if (d <= 1.5) {
          if (decision.targetTreeId) {
            // Harvesting a 2x2 tree entity
            const woodSpeedBonus = getHarvestSpeedBonus(agent.skills, 'wood');
            // Check equipped tool for woodcutting bonus
            let toolWoodBonus = 0;
            const woodTool = agent.inventory.equipped.mainHand;
            if (woodTool) {
              const toolDef = getItemDef(woodTool.itemId);
              toolWoodBonus = toolDef.woodcuttingBonus || 0;
              if (woodTool.durability !== undefined) {
                woodTool.durability--;
                if (woodTool.durability <= 0) {
                  agent.inventory.equipped.mainHand = undefined;
                }
              }
            }
            const harvestAmount = (5 + agent.skills.woodcutting.level / 10) * (1 + woodSpeedBonus) * (1 + toolWoodBonus);
            const result = world.harvestTree(decision.targetTreeId, harvestAmount);
            if (result) {
              agent.resources.wood += result.harvested;
              // Bonus yield chance
              if (Math.random() < agent.skills.woodcutting.level * 0.005) {
                agent.resources.wood += 1;
              }
              awardXP(agent.skills, 'woodcutting', 1.0);
              if (result.becameStump) {
                // Tree depleted → stump + clear surrounding tiles
                const tree = world.trees.find(t => t.id === decision.targetTreeId);
                if (tree) {
                  // Report tile changes for the 2x2 area becoming grass + stump
                  for (let dy = 0; dy < 2; dy++) {
                    for (let dx = 0; dx < 2; dx++) {
                      tileChanges.push({ x: tree.x + dx, y: tree.y + dy, type: world.getTile(tree.x + dx, tree.y + dy) });
                    }
                  }
                }
                if (result.seedDrop) {
                  agent.resources.treeSeed += 1;
                }
              }
            }
          } else if (decision.targetRockId) {
            // Harvesting a rock entity
            const stoneSpeedBonus = getHarvestSpeedBonus(agent.skills, 'stone');
            // Check equipped tool for mining bonus
            let toolMineBonus = 0;
            const mineTool = agent.inventory.equipped.mainHand;
            if (mineTool) {
              const mineToolDef = getItemDef(mineTool.itemId);
              toolMineBonus = mineToolDef.miningBonus || 0;
              if (mineTool.durability !== undefined) {
                mineTool.durability--;
                if (mineTool.durability <= 0) {
                  agent.inventory.equipped.mainHand = undefined;
                }
              }
            }
            const harvestAmount = (5 + agent.skills.mining.level / 10) * (1 + stoneSpeedBonus) * (1 + toolMineBonus);
            const result = world.harvestRock(decision.targetRockId, harvestAmount);
            if (result) {
              agent.resources.stone += result.harvested;
              // Bonus yield chance
              if (Math.random() < agent.skills.mining.level * 0.005) {
                agent.resources.stone += 1;
              }
              awardXP(agent.skills, 'mining', 1.2);
            }
          } else if (decision.targetPlantId) {
            // Interacting with a plant entity
            const plant = world.plants.find(p => p.id === decision.targetPlantId);
            if (plant) {
              switch (plant.type) {
                case PlantType.BERRY_BUSH: {
                  const plantSpeedBonus = getHarvestSpeedBonus(agent.skills, 'plant');
                  // Check equipped tool for harvest bonus
                  let toolHarvestBonus = 0;
                  const harvestTool = agent.inventory.equipped.mainHand;
                  if (harvestTool) {
                    const harvestToolDef = getItemDef(harvestTool.itemId);
                    toolHarvestBonus = harvestToolDef.harvestBonus || 0;
                    if (harvestTool.durability !== undefined) {
                      harvestTool.durability--;
                      if (harvestTool.durability <= 0) {
                        agent.inventory.equipped.mainHand = undefined;
                      }
                    }
                  }
                  const harvestAmt = (5 + agent.skills.foraging.level / 10) * (1 + plantSpeedBonus) * (1 + toolHarvestBonus);
                  const result = world.harvestPlant(plant.id, harvestAmt);
                  if (result) {
                    agent.resources.food += result.harvested;
                    agent.needs.plantHunger = clamp(agent.needs.plantHunger + 5, 0, 100);
                    awardXP(agent.skills, 'foraging', 0.8, 0.8); // berry bush: common
                    if (result.seedDrop) {
                      agent.resources.plantSeed += 1;
                    }
                  }
                  break;
                }
                case PlantType.MUSHROOM: {
                  // Edible mushroom — but low survival skill may confuse with poison
                  const consumed = world.consumePlant(plant.id);
                  if (consumed) {
                    agent.needs.plantHunger = clamp(agent.needs.plantHunger + 15, 0, 100);
                    agent.resources.food += 3;
                    awardXP(agent.skills, 'foraging', 0.8, 1.0); // mushroom: standard
                  }
                  break;
                }
                case PlantType.POISON_SHROOM: {
                  // Agent doesn't know it's poison — eats it thinking it's food
                  const consumed = world.consumePlant(plant.id);
                  if (consumed) {
                    agent.needs.health = clamp(agent.needs.health - 25, 0, 100);
                    // Defense XP from surviving poison damage
                    awardXP(agent.skills, 'defense', 2.0, 2.5);
                  }
                  break;
                }
                case PlantType.FLOWER: {
                  const consumed = world.consumePlant(plant.id);
                  if (consumed) {
                    agent.needs.health = clamp(agent.needs.health + 30, 0, 100);
                  }
                  break;
                }
                case PlantType.STAMINA_HERB: {
                  const consumed = world.consumePlant(plant.id);
                  if (consumed) {
                    agent.needs.stamina = clamp(agent.needs.stamina + 35, 0, 100);
                  }
                  break;
                }
                case PlantType.HUNGER_HERB: {
                  const consumed = world.consumePlant(plant.id);
                  if (consumed) {
                    agent.needs.plantHunger = clamp(agent.needs.plantHunger + 20, 0, 100);
                    awardXP(agent.skills, 'foraging', 0.8, 1.2); // hunger herb: uncommon
                  }
                  break;
                }
                case PlantType.EDIBLE_FLOWER: {
                  const consumed = world.consumePlant(plant.id);
                  if (consumed) {
                    agent.needs.plantHunger = clamp(agent.needs.plantHunger + 10, 0, 100);
                    awardXP(agent.skills, 'foraging', 0.8, 1.2); // edible flower: uncommon
                  }
                  break;
                }
              }
            }
          } else if (decision.targetAnimalId) {
            // Hunting an animal
            const prey = world.animals.find(a => a.id === decision.targetAnimalId);
            if (prey && prey.alive) {
              const d2 = distance(agent.x, agent.y, prey.x, prey.y);
              if (d2 <= 1.5) {
                // Attack cooldown check
                if (agent.attackCooldown > 0) { agent.attackCooldown--; break; }
                agent.attackCooldown = Math.max(5, 10 - Math.floor(agent.skills.combat.level / 20)); // 5-10 ticks, faster with combat skill

                // Hit accuracy check
                const accuracy = getHitAccuracy(agent.skills);
                if (Math.random() > accuracy) break; // miss
                // Dodge check for animal target
                const animalDodge = getDodgeChance(prey.skills);
                if (Math.random() < animalDodge) break; // animal dodged
                // Check equipped weapon for attack bonus
                let weaponBonus = 0;
                const weapon = agent.inventory.equipped.mainHand;
                if (weapon) {
                  const weaponDef = getItemDef(weapon.itemId);
                  weaponBonus = weaponDef.attackBonus || 0;
                  if (weapon.durability !== undefined) {
                    weapon.durability--;
                    if (weapon.durability <= 0) agent.inventory.equipped.mainHand = undefined;
                  }
                }
                // Attack the animal using stat-based damage
                let damage = getAttackDamage(agent.baseStats, agent.skills, 10 + weaponBonus);
                // Apply animal's defense
                const preySpecies = getSpecies(prey.species);
                if (damage > 0) {
                  const animalDef = getAnimalDefense(prey, preySpecies);
                  damage = Math.max(1, damage * (1 - animalDef));
                }
                prey.health = clamp(prey.health - damage, 0, prey.maxHealth);
                // Combat XP with difficulty modifier based on animal strength
                const diffMod = clamp(preySpecies.attack / Math.max(1, 10 + agent.skills.combat.level * 0.5), 0.5, 3.0);
                awardXP(agent.skills, 'combat', 3.0, diffMod);
                // Mark animal as attacked by this agent
                prey.lastAttackedBy = { type: 'agent', id: agent.id, tick: agent.age };
                if (prey.health <= 0) {
                  prey.alive = false;
                  prey.action = 'dying';
                  agent.resources.food += preySpecies.foodDrop;
                  agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + preySpecies.foodDrop * 5, 0, 100);
                }
              } else {
                moveTowards(agent, prey.x, prey.y, world);
              }
            }
          } else if (decision.targetCorpseId) {
            // Harvesting a corpse
            const corpse = world.corpses.find(c => c.id === decision.targetCorpseId);
            if (corpse) {
              const d2 = distance(agent.x, agent.y, corpse.x, corpse.y);
              if (d2 <= 1.5) {
                // Extract one random material per tick
                const available = Object.entries(corpse.materials).filter(([, v]) => v != null && v > 0);
                if (available.length > 0) {
                  const [mat, amt] = available[Math.floor(Math.random() * available.length)];
                  (corpse.materials as any)[mat] = (amt as number) - 1;
                  (agent.resources as any)[mat] = ((agent.resources as any)[mat] || 0) + 1;
                  // Meat restores protein hunger slightly
                  if (mat === 'meat') {
                    agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + 5, 0, 100);
                  }
                  awardXP(agent.skills, 'foraging', 0.8);
                }
                // Also grab carried resources if any
                if (corpse.carriedResources) {
                  const carriedAvail = Object.entries(corpse.carriedResources).filter(([, v]) => v != null && v > 0);
                  if (carriedAvail.length > 0) {
                    const [res, resAmt] = carriedAvail[Math.floor(Math.random() * carriedAvail.length)];
                    (corpse.carriedResources as any)[res] = (resAmt as number) - 1;
                    (agent.resources as any)[res] = ((agent.resources as any)[res] || 0) + 1;
                  }
                }
                // Remove corpse if all materials and carried resources are empty
                const matRemaining = Object.values(corpse.materials).reduce((s, v) => s + (v || 0), 0);
                const carriedRemaining = corpse.carriedResources
                  ? Object.values(corpse.carriedResources).reduce((s, v) => s + (v || 0), 0)
                  : 0;
                if (matRemaining <= 0 && carriedRemaining <= 0) {
                  world.corpses = world.corpses.filter(c => c.id !== corpse.id);
                }
              } else {
                moveTowards(agent, corpse.x, corpse.y, world);
              }
            }
          } else {
            // Check if target is iron ore
            const targetTile = world.getTile(decision.target.x, decision.target.y);
            if (targetTile === TileType.IRON_ORE) {
              const ironTool = agent.inventory.equipped.mainHand;
              // Iron ore requires iron pickaxe specifically
              if (ironTool?.itemId === 'iron_pickaxe') {
                const ironToolDef = getItemDef(ironTool.itemId);
                const mineAmount = (3 + agent.skills.mining.level / 10) * (1 + (ironToolDef.miningBonus ?? 0));
                const health = world.resourceHealth[decision.target.y]?.[decision.target.x] ?? 0;
                if (health > 0) {
                  const harvested = Math.min(mineAmount, health);
                  world.resourceHealth[decision.target.y][decision.target.x] -= harvested;
                  agent.resources.iron_ore += 1; // 1 ore per hit
                  awardXP(agent.skills, 'mining', 1.5);
                  if (ironTool!.durability !== undefined) {
                    ironTool!.durability--;
                    if (ironTool!.durability <= 0) agent.inventory.equipped.mainHand = undefined;
                  }
                  if (world.resourceHealth[decision.target.y][decision.target.x] <= 0) {
                    world.setTile(decision.target.x, decision.target.y, TileType.DIRT);
                    tileChanges.push({ x: decision.target.x, y: decision.target.y, type: TileType.DIRT });
                  }
                }
              }
            } else {
              // Harvesting a 1x1 resource tile (legacy)
              const result = world.harvest(decision.target.x, decision.target.y, 5 + agent.skills.foraging.level / 10);
              if (result) {
                (agent.resources as any)[result.resource] += result.amount;
                awardXP(agent.skills, 'foraging', 0.8);
                if (result.resource === 'food') {
                  agent.needs.plantHunger = clamp(agent.needs.plantHunger + 5, 0, 100);
                }
                if (world.resourceHealth[decision.target.y]?.[decision.target.x] <= 0) {
                  tileChanges.push({ x: decision.target.x, y: decision.target.y, type: TileType.GRASS });
                }
              }
            }
          }
        } else {
          moveTowards(agent, decision.target.x, decision.target.y, world);
        }
      }
      break;
    }

    case 'resting': {
      agent.needs.stamina = clamp(agent.needs.stamina + REST_RESTORE * 0.3, 0, 100);
      break;
    }

    case 'building': {
      // Find a building recipe from the new recipe system
      const buildRecipe = NEW_RECIPES.find(r => {
        if (r.skillType !== 'building') return false;
        if (r.produces.type !== 'tile') return false;
        const skillLevel = agent.skills.building.level;
        if (skillLevel < r.skillRequired) return false;
        // Don't build station-type structures if one already exists nearby (prevent spam)
        const producedTile = r.produces.tileType as TileType;
        if (producedTile === TileType.CAMPFIRE || producedTile === TileType.WORKBENCH || producedTile === TileType.FORGE) {
          if (world.findNearest(ax, ay, producedTile, 10) !== null) return false;
        }
        // Check station requirement
        if (r.station === 'workbench' && !isAdjacentToTile(ax, ay, TileType.WORKBENCH, world)) return false;
        if (r.station === 'forge' && !isAdjacentToTile(ax, ay, TileType.FORGE, world)) return false;
        return Object.entries(r.requires).every(
          ([res, amt]) => ((agent.resources as any)[res] || 0) >= amt
        );
      });

      if (buildRecipe && buildRecipe.produces.tileType !== undefined) {
        // Find empty grass tile nearby
        const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
        for (const { dx, dy } of dirs) {
          const bx = ax + dx;
          const by = ay + dy;
          const bt = world.getTile(bx, by);
          if (bt === TileType.GRASS || bt === TileType.DIRT || bt === TileType.SAND) {
            // Consume resources with building efficiency bonus
            const efficiency = 1.0 - agent.skills.building.level * 0.003;
            for (const [res, amt] of Object.entries(buildRecipe.requires)) {
              const effectiveAmt = Math.max(1, Math.floor(amt * efficiency));
              (agent.resources as any)[res] -= effectiveAmt;
            }
            const builtTileType = buildRecipe.produces.tileType as TileType;
            world.setTile(bx, by, builtTileType);
            // Track as structure if it has HP
            world.placeStructure(bx, by, builtTileType, agent.id, agent.age);
            awardXP(agent.skills, 'building', 1.0);
            agent.needs.shelter = clamp(agent.needs.shelter + 20, 0, 100);
            tileChanges.push({ x: bx, y: by, type: builtTileType });
            break;
          }
        }
      }
      break;
    }

    case 'crafting': {
      // Check if agent is near a crafting station
      const nearCampfire = isAdjacentToTile(ax, ay, TileType.CAMPFIRE, world);
      const nearWorkbench = isAdjacentToTile(ax, ay, TileType.WORKBENCH, world);
      const nearForge = isAdjacentToTile(ax, ay, TileType.FORGE, world);

      // Find best recipe the agent can craft
      const availableRecipes = NEW_RECIPES.filter(recipe => {
        // Check skill requirement
        const skillLevel = recipe.skillType === 'crafting'
          ? agent.skills.crafting.level
          : agent.skills.building.level;
        if (skillLevel < recipe.skillRequired) return false;

        // Check station requirement
        if (recipe.station === 'campfire' && !nearCampfire) return false;
        if (recipe.station === 'workbench' && !nearWorkbench) return false;
        if (recipe.station === 'forge' && !nearForge) return false;

        // Check materials
        for (const [mat, qty] of Object.entries(recipe.requires)) {
          if (((agent.resources as any)[mat] || 0) < qty) return false;
        }

        return true;
      });

      if (availableRecipes.length > 0) {
        // Pick the highest-skill recipe (most valuable)
        const craftRecipe = availableRecipes.sort((a, b) => b.skillRequired - a.skillRequired)[0];

        // Consume materials
        for (const [mat, qty] of Object.entries(craftRecipe.requires)) {
          (agent.resources as any)[mat] -= qty;
        }

        // Produce output
        if (craftRecipe.produces.type === 'tile' && craftRecipe.produces.tileType !== undefined) {
          // Place tile adjacent to agent
          const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
          for (const {dx, dy} of dirs) {
            const bx = ax + dx, by = ay + dy;
            const bt = world.getTile(bx, by);
            if (bt === TileType.GRASS || bt === TileType.DIRT) {
              const craftedTileType = craftRecipe.produces.tileType as TileType;
              world.setTile(bx, by, craftedTileType);
              // Track as structure if it has HP
              world.placeStructure(bx, by, craftedTileType, agent.id, agent.age);
              tileChanges.push({ x: bx, y: by, type: craftedTileType });
              break;
            }
          }
        } else if (craftRecipe.produces.type === 'item' && craftRecipe.produces.itemId) {
          // Add item to inventory
          const qty = craftRecipe.produces.quantity || 1;
          const existing = agent.inventory.items.find(i => i.itemId === craftRecipe.produces.itemId);
          const def = getItemDef(craftRecipe.produces.itemId!);
          // Craft quality bonus: crafting skill increases durability
          const qualityBonus = 1 + agent.skills.crafting.level * 0.005;
          const craftedDurability = def.durability
            ? Math.floor(def.durability * qualityBonus)
            : undefined;
          if (existing && def.stackable) {
            existing.quantity += qty;
          } else {
            agent.inventory.items.push({
              itemId: craftRecipe.produces.itemId!,
              quantity: qty,
              durability: craftedDurability,
            });
          }
        }

        // Award XP
        awardXP(agent.skills, craftRecipe.skillType === 'crafting' ? 'crafting' : 'building', 1.5);
      }
      break;
    }

    case 'socializing': {
      // Taming: if targeting an animal
      if (decision.targetAnimalId) {
        const animal = world.animals.find(a => a.id === decision.targetAnimalId);
        if (animal && animal.alive && !animal.tamed) {
          const d = distance(agent.x, agent.y, animal.x, animal.y);
          if (d <= 2) {
            const species = getSpecies(animal.species);
            // Feed the animal
            if (agent.resources.meat > 0) {
              agent.resources.meat--;
              animal.tamingProgress++;
              animal.proteinHunger = clamp(animal.proteinHunger + 15, 0, 100);
            } else if (agent.resources.food > 0) {
              agent.resources.food--;
              animal.tamingProgress++;
              animal.plantHunger = clamp(animal.plantHunger + 15, 0, 100);
            }
            // Check if taming complete
            if (animal.tamingProgress >= species.tamingCost) {
              animal.tamed = true;
              animal.tamedBy = agent.id;
              animal.homeX = Math.floor(agent.x);
              animal.homeY = Math.floor(agent.y);
            }
            awardXP(agent.skills, 'social', 1.0);
          } else {
            moveTowards(agent, animal.x, animal.y, world);
          }
        }
      } else if (decision.target) {
        const d = distance(agent.x, agent.y, decision.target.x, decision.target.y);
        if (d <= 2) {
          const nearbyAgent = allAgents.find(
            a => a.id !== agent.id && a.alive &&
            Math.floor(a.x) === decision.target!.x && Math.floor(a.y) === decision.target!.y
          );
          if (nearbyAgent) {
            // Social interaction
            const outcome = Math.random() < 0.7 ? randomOutcome(3, 8) : randomOutcome(-3, -1);
            agent.needs.social = clamp(agent.needs.social + SOCIAL_RESTORE, 0, 100);
            nearbyAgent.needs.social = clamp(nearbyAgent.needs.social + SOCIAL_RESTORE * 0.5, 0, 100);
            agent.relationships[nearbyAgent.id] = clamp(
              (agent.relationships[nearbyAgent.id] ?? 0) + outcome, -100, 100
            );
            nearbyAgent.relationships[agent.id] = clamp(
              (nearbyAgent.relationships[agent.id] ?? 0) + outcome * 0.5, -100, 100
            );
            awardXP(agent.skills, 'social', 1.0);
            agent.socialScore += outcome > 0 ? 1 : -1;

            interactions.push({
              agentA: agent.id,
              agentB: nearbyAgent.id,
              type: outcome > 0 ? 'conversation' : 'conflict',
              outcome,
              timestamp: Date.now(),
            });

            // Social recovery: small health + stamina boost — only if basic needs met
            if (outcome > 0 && agent.needs.thirst > 10 && agent.needs.proteinHunger > 10) {
              agent.needs.health = clamp(agent.needs.health + 1, 0, 100);
              agent.needs.stamina = clamp(agent.needs.stamina + 2, 0, 100);
            }

            // Trading: charisma-scaled chance to swap surplus resources
            // High CHA agents trade more often and get better deals
            const tradeChance = 0.1 + (agent.baseStats.charisma * 0.02); // 10-38% based on CHA
            if (Math.random() < tradeChance && outcome > 0) {
              const tradeAmount = 2 + Math.floor(agent.skills.social.level / 10); // 2-12 based on skill
              // Trade what agent has surplus for what it lacks
              const trades: [keyof typeof agent.resources, keyof typeof agent.resources][] = [
                ['food', 'wood'], ['food', 'stone'], ['wood', 'food'],
                ['wood', 'stone'], ['stone', 'food'], ['stone', 'wood'],
                ['meat', 'food'], ['meat', 'wood'],
              ];
              for (const [give, get] of trades) {
                if ((agent.resources[give] as number) > 5 && (nearbyAgent.resources[get] as number) > 5) {
                  (agent.resources[give] as number) -= tradeAmount;
                  (agent.resources[get] as number) += tradeAmount;
                  (nearbyAgent.resources[give] as number) += Math.floor(tradeAmount * 0.8); // other gets 80%
                  (nearbyAgent.resources[get] as number) -= tradeAmount;
                  break; // one trade per interaction
                }
              }
            }
          }
        } else {
          moveTowards(agent, decision.target.x, decision.target.y, world);
        }
      }
      break;
    }

    case 'wandering': {
      // Pick a random nearby walkable tile — scouts explore further
      const exploreRange = 5 + Math.floor(agent.skills.survival.level / 20); // 5-10
      if (!agent.actionTarget || distance(agent.x, agent.y, agent.actionTarget.x, agent.actionTarget.y) < 1) {
        const wx = ax + Math.floor(Math.random() * exploreRange * 2) - exploreRange;
        const wy = ay + Math.floor(Math.random() * exploreRange * 2) - exploreRange;
        agent.actionTarget = { x: wx, y: wy };
      }
      // Athletics boosts all movement speed; extra boost when fleeing
      const isFleeing = decision.reason?.includes('threatened') || decision.reason?.includes('flee');
      const athleticsSpeedMult = 1 + agent.skills.athletics.level * 0.005; // +0.5% per level base
      const fleeBonus = isFleeing ? (1 + agent.skills.athletics.level * 0.008) : 1.0; // extra when fleeing
      moveTowards(agent, agent.actionTarget.x, agent.actionTarget.y, world, athleticsSpeedMult * fleeBonus);
      break;
    }

    case 'planting': {
      const dirs = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
        { dx: 2, dy: 0 }, { dx: -2, dy: 0 }, { dx: 0, dy: 2 }, { dx: 0, dy: -2 },
        { dx: 1, dy: 1 }, { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 },
      ];
      // Plant food seed (berry bush) if available and hungry
      if (agent.resources.plantSeed > 0 && decision.reason?.includes('food plant')) {
        for (const { dx, dy } of dirs) {
          const px = ax + dx;
          const py = ay + dy;
          const plant = world.plantFoodSeed(px, py, PlantType.BERRY_BUSH);
          if (plant) {
            agent.resources.plantSeed -= 1;
            awardXP(agent.skills, 'foraging', 1.0);
            break;
          }
        }
      }
      // Plant tree seed
      else if (agent.resources.treeSeed > 0) {
        for (const { dx, dy } of dirs) {
          const px = ax + dx;
          const py = ay + dy;
          const result = world.plantSeed(px, py);
          if (result) {
            agent.resources.treeSeed -= 1;
            tileChanges.push(...result.tileChanges);
            awardXP(agent.skills, 'foraging', 1.0);
            break;
          }
        }
      }
      break;
    }

    case 'following_message':
    case 'idle':
    default:
      break;
  }

  // Athletics XP from movement
  if (agent.action === 'wandering' || agent.action === 'drinking' || agent.action === 'harvesting') {
    if (decision.target) {
      const moved = distance(agent.x, agent.y, decision.target.x, decision.target.y);
      if (moved > 0.1) {
        const fleeMod = agent.action === 'wandering' && decision.reason?.includes('flee') ? 2.0
          : agent.action === 'wandering' && decision.reason?.includes('threatened') ? 2.0
          : 1.0;
        awardXP(agent.skills, 'athletics', 0.5, fleeMod);
      }
    }
  }

  return { tileChanges, interactions };
}

function moveTowards(agent: AgentState, tx: number, ty: number, world: World, speedMultiplier: number = 1.0): void {
  const path = findPath(world, Math.floor(agent.x), Math.floor(agent.y), Math.floor(tx), Math.floor(ty));
  if (path.length > 0) {
    const next = path[0];
    const speed = getAgentSpeed(agent) * speedMultiplier;
    const dx = next.x - agent.x;
    const dy = next.y - agent.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      agent.x += (dx / d) * Math.min(speed, d);
      agent.y += (dy / d) * Math.min(speed, d);
    }
  }
}

function randomOutcome(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
