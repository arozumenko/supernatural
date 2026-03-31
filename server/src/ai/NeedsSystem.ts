import {
  AgentState, AgentAction, TileType, PlantType, AnimalState, InventoryItem, SpatialMemoryEntry, clamp, distance,
  BehaviorGenome, WORLD_WIDTH, WORLD_HEIGHT
} from '../../shared/src/index.ts';
import { World } from '../World.ts';
import { findPath } from './Pathfinding.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';
import { awardXP, getNeedDecayReduction, getHitAccuracy, getAttackDamage, getDamageReduction, getHarvestSpeedBonus, getAgentSpeed, getAnimalDefense, getDodgeChance, canIdentifyPoison } from '../Progression.ts';
import { RECIPES as NEW_RECIPES } from '../RecipeDefinitions.ts';
import { getItemDef } from '../ItemDefinitions.ts';
import {
  GOAPAction, buildWorldState, selectGoal, planGOAP, planInvalidated,
  GOAP_ACTIONS, serializePlan
} from './GOAPPlanner.ts';
import { createDefaultGenome } from './BehaviorGenome.ts';
import { executePendingPlan } from '../api/plan-executor.ts';
import { evaluateStrategyRules } from './StrategyRules.ts';
import { WorldConfig } from '../WorldConfig.ts';
import { baseDecayNeeds, baseEvaluateStuckEscape } from './BaseNeedsSystem.ts';
import type { Being } from './SharedDecisionEngine.ts';

const cfg = WorldConfig;

// Base decay rates per tick — from WorldConfig
const HUNGER_DECAY = cfg.needs.decayRates.hunger;
const THIRST_DECAY = cfg.needs.decayRates.thirst;
const STAMINA_DECAY = cfg.needs.decayRates.stamina;
const SOCIAL_DECAY = cfg.needs.decayRates.social;
const SHELTER_DECAY = cfg.needs.decayRates.shelter;

// How much actions restore — from WorldConfig
const EAT_RESTORE = cfg.needs.restoreAmounts.eat;
const DRINK_RESTORE = cfg.needs.restoreAmounts.drink;
const REST_RESTORE = cfg.needs.restoreAmounts.rest;
const SOCIAL_RESTORE = cfg.needs.restoreAmounts.social;

// Activity metabolism multipliers — from WorldConfig
const ACTIVITY_MULTIPLIERS: Record<string, number> = cfg.activityMultipliers;

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
  targetAgentId?: string;
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
const socialCooldowns = new Map<string, number>(); // pairKey → last interaction tick
// Per-agent disposition toward another: "agentA→agentB" = friend/foe
// A can be friend to B while B is foe to A
const agentDisposition = new Map<string, 'friend' | 'foe'>();

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

/** Clear social dispositions involving a dead agent — reset on next meeting */
export function clearDispositions(agentId: string, allAgents?: AgentState[]): void {
  for (const key of agentDisposition.keys()) {
    if (key.includes(agentId)) agentDisposition.delete(key);
  }
  for (const key of socialCooldowns.keys()) {
    if (key.includes(agentId)) socialCooldowns.delete(key);
  }
  // Remove from all alliances + clear own allies
  if (allAgents) {
    for (const other of allAgents) {
      if (other.id === agentId) {
        other.allies = [];
      } else if (other.allies) {
        other.allies = other.allies.filter(id => id !== agentId);
      }
    }
  }
}

export function decayNeeds(agent: AgentState): void {
  if (!agent.alive) return;

  // Build a Being adapter so baseDecayNeeds can mutate flat fields
  const survivalReduction = 1 - getNeedDecayReduction(agent.skills);
  const being: Being = {
    x: agent.x,
    y: agent.y,
    health: agent.needs.health,
    proteinHunger: agent.needs.proteinHunger,
    plantHunger: agent.needs.plantHunger,
    thirst: agent.needs.thirst,
    stamina: agent.needs.stamina,
    baseStats: agent.baseStats,
    skills: agent.skills as unknown as Record<string, { xp: number; level: number }>,
    alive: agent.alive,
    action: agent.action,
    lastAttackedBy: agent.lastAttackedBy,
    attackCooldown: agent.attackCooldown,
    age: agent.age,
  };

  const rh = cfg.needs.healthRegen;
  const envDamage = baseDecayNeeds(being, 'agent', {
    diet: 'omnivore',
    size: 'medium',
    hungerDecayRate: HUNGER_DECAY * survivalReduction,
    thirstDecayRate: THIRST_DECAY * survivalReduction,
    staminaDecayRate: STAMINA_DECAY,
    maxHealth: 100,
    starvationDamage: {
      both: cfg.needs.starvationDamage.both,
      single: cfg.needs.starvationDamage.single,
      dehydration: cfg.needs.starvationDamage.dehydration,
      exhaustion: cfg.needs.starvationDamage.exhaustion,
    },
    healthRegen: {
      restInterval: rh.restInterval,
      restBase: rh.restBase,
      restSkillBonus: rh.restSkillBonus,
    },
  });

  // Copy shared fields back from Being adapter
  agent.needs.proteinHunger = being.proteinHunger;
  agent.needs.plantHunger = being.plantHunger;
  agent.needs.thirst = being.thirst;
  agent.needs.stamina = being.stamina;
  agent.needs.health = being.health;
  agent.attackCooldown = being.attackCooldown;

  // --- Agent-specific decay: social & shelter ---
  agent.needs.social = clamp(agent.needs.social - SOCIAL_DECAY, 0, 100);
  agent.needs.shelter = clamp(agent.needs.shelter - SHELTER_DECAY, 0, 100);

  // Exposure damage: no shelter slowly drains health (agent-only)
  if (agent.needs.shelter <= 0) {
    const exposureDmg = cfg.needs.starvationDamage.exposure;
    agent.needs.health = clamp(agent.needs.health - exposureDmg, 0, 100);
    // Exposure awards additional survival XP
    if (exposureDmg > 0) {
      awardXP(agent.skills, 'survival', 0.2, exposureDmg);
    }
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

    // Only consider animals that hunt agents OR have RECENTLY attacked this agent
    // A fox hunting a rabbit or a cow grazing nearby is NOT a threat
    const huntsAgents = species.hunts?.includes('agent') ?? false;
    const recentlyAttackedMe = agent.lastAttackedBy?.type === 'animal'
      && agent.lastAttackedBy.id === animal.id
      && (agent.age - agent.lastAttackedBy.tick) < 50; // forget after 5 seconds
    if (!huntsAgents && !recentlyAttackedMe) continue;

    const dist = distance(agent.x, agent.y, animal.x, animal.y);

    // Perception-based detection range — wider when predator is actively hunting
    const baseDetect = genome.thresholds.threatDetectBase + (agent.skills.survival.level * 0.1);
    const isHunting = animal.action === 'hunting' || animal.action === 'stalking';
    const detectRange = (huntsAgents && isHunting) ? baseDetect * 2 : baseDetect;

    // Sound detection for large moving predators (only when hunting)
    const sizeNum = species.size === 'large' ? 4 : species.size === 'medium' ? 3 : species.size === 'small' ? 2 : 1;
    const noise = sizeNum * (animal.action === 'hunting' ? 0.5 : 0.1);
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
    const wasAttacked = recentlyAttackedMe;

    const proximityUrgency = 1 - (dist / Math.max(detectRange, soundRange));
    // Confidence reduces flee urgency — powerful agents stand their ground more
    let fleePriority = Math.floor(genome.interruptWeights.fleeBase + (dangerRatio * proximityUrgency * 35) - (confidence * 10));
    // Desperate agents don't flee as readily — they'll fight for survival
    const desperation = (agent.needs.proteinHunger < 15 || agent.needs.thirst < 15) ? 25 : 0;
    fleePriority -= desperation;
    if (wasAttacked) fleePriority = Math.min(fleePriority + 20, 98);

    // Don't flee from predators that are faster — running is futile, stand and fight
    const agentSpeed = getAgentSpeed(agent);
    if (species.speed > agentSpeed * 1.1) {
      fleePriority = 0;
    }

    if (fleePriority > 60) {
      // Smart flee: try to flee toward a useful resource (water/food) that's away from predator
      const awayDx = agent.x - animal.x;
      const awayDy = agent.y - animal.y;
      const awayLen = Math.sqrt(awayDx * awayDx + awayDy * awayDy) || 1;
      let fleeX = Math.floor(agent.x + (awayDx / awayLen) * 8);
      let fleeY = Math.floor(agent.y + (awayDy / awayLen) * 8);

      // Try to find water/food in the flee direction (not back toward predator)
      const water = world.findNearest(ax, ay, TileType.WATER, 15);
      if (water) {
        const toWaterDx = water.x - agent.x;
        const toWaterDy = water.y - agent.y;
        // Only flee toward water if it's generally away from predator (dot product > 0)
        if (toWaterDx * awayDx + toWaterDy * awayDy > 0) {
          fleeX = water.x;
          fleeY = water.y;
        }
      }

      // Add slight randomization to prevent stuck-in-corner loops
      fleeX += Math.floor(Math.random() * 6) - 3;
      fleeY += Math.floor(Math.random() * 6) - 3;
      // Clamp to map bounds
      fleeX = Math.max(1, Math.min(fleeX, WORLD_WIDTH - 2));
      fleeY = Math.max(1, Math.min(fleeY, WORLD_HEIGHT - 2));

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

  // --- Self-defense against agent attackers (lower priority than critical survival) ---
  if (agent.lastAttackedBy?.type === 'agent') {
    const attackerAgent = allAgents.find(a => a.id === agent.lastAttackedBy!.id && a.alive);
    if (attackerAgent) {
      const distToAttacker = distance(agent.x, agent.y, attackerAgent.x, attackerAgent.y);
      if (distToAttacker < 3) {
        // Priority 85: below thirst(95) and hunger(90) so agent disengages to survive
        decisions.push({
          action: 'harvesting',
          priority: 85,
          target: { x: Math.floor(attackerAgent.x), y: Math.floor(attackerAgent.y) },
          targetAgentId: attackerAgent.id,
          reason: `fighting ${attackerAgent.name}`
        });
      } else if (agent.needs.health < 50) {
        // Attacker far + injured → flee
        const fx = Math.floor(agent.x + (agent.x - attackerAgent.x) * 2);
        const fy = Math.floor(agent.y + (agent.y - attackerAgent.y) * 2);
        decisions.push({
          action: 'wandering', priority: 70,
          target: { x: clamp(fx, 1, WORLD_WIDTH - 2), y: clamp(fy, 1, WORLD_HEIGHT - 2) },
          reason: `fleeing from ${attackerAgent.name}`
        });
      }
    }
  }

  // --- Group defense: help nearby ally or alliance member under attack ---
  if (!agent.lastAttackedBy) {
    const myAllies = agent.allies ?? [];
    for (const ally of allAgents) {
      if (ally.id === agent.id || !ally.alive) continue;
      if (!ally.lastAttackedBy) continue;
      const allyDist = distance(agent.x, agent.y, ally.x, ally.y);
      // Alliance members get extended defense range (15 tiles vs 8)
      const isAllied = myAllies.includes(ally.id);
      const defenseRange = isAllied ? 15 : genome.thresholds.groupDefenseRange;
      if (allyDist > defenseRange) continue;
      // Non-allied agents only get help against animals (existing behavior)
      if (!isAllied && ally.lastAttackedBy.type !== 'animal') continue;

      // Alliance defense priority: near fight-back level (90) — allies protect each other until death
      const allyDefensePriority = isAllied ? 90 : genome.interruptWeights.groupDefense;

      if (ally.lastAttackedBy.type === 'animal') {
        const attacker = world.animals.find(a => a.id === ally.lastAttackedBy!.id && a.alive);
        if (!attacker) continue;
        const distToAttacker = distance(agent.x, agent.y, attacker.x, attacker.y);
        if (distToAttacker < 20) {
          decisions.push({
            action: 'harvesting',
            priority: allyDefensePriority,
            target: { x: Math.floor(attacker.x), y: Math.floor(attacker.y) },
            targetAnimalId: attacker.id,
            reason: `defending ${isAllied ? 'ally' : ''} ${ally.name}`
          });
          break;
        }
      } else if (ally.lastAttackedBy.type === 'agent' && isAllied) {
        // Defend allied agent from hostile agent
        const attackerAgent = allAgents.find(a => a.id === ally.lastAttackedBy!.id && a.alive);
        if (!attackerAgent) continue;
        const distToAttacker = distance(agent.x, agent.y, attackerAgent.x, attackerAgent.y);
        if (distToAttacker < 20) {
          decisions.push({
            action: 'harvesting',
            priority: allyDefensePriority,
            target: { x: Math.floor(attackerAgent.x), y: Math.floor(attackerAgent.y) },
            targetAgentId: attackerAgent.id,
            reason: `defending ally ${ally.name}`
          });
          break;
        }
      }
    }
  }

  // --- Defend tamed animals under attack ---
  {
    const myTamed = world.animals.filter(a => a.alive && a.tamedBy === agent.id);
    for (const pet of myTamed) {
      if (!pet.lastAttackedBy) continue;
      if (agent.age - pet.lastAttackedBy.tick > 30) continue; // recent only
      const petDist = distance(agent.x, agent.y, pet.x, pet.y);
      if (petDist > 12) continue;
      if (pet.lastAttackedBy.type === 'animal') {
        const attacker = world.animals.find(a => a.id === pet.lastAttackedBy!.id && a.alive);
        if (attacker) {
          decisions.push({
            action: 'harvesting',
            priority: genome.interruptWeights.groupDefense + 3,
            target: { x: Math.floor(attacker.x), y: Math.floor(attacker.y) },
            targetAnimalId: attacker.id,
            reason: `protecting tamed ${getSpecies(pet.species).name}`
          });
          break;
        }
      } else if (pet.lastAttackedBy.type === 'agent') {
        const attackerAgent = allAgents.find(a => a.id === pet.lastAttackedBy!.id && a.alive);
        if (attackerAgent) {
          decisions.push({
            action: 'harvesting',
            priority: genome.interruptWeights.groupDefense + 3,
            target: { x: Math.floor(attackerAgent.x), y: Math.floor(attackerAgent.y) },
            targetAgentId: attackerAgent.id,
            reason: `protecting tamed ${getSpecies(pet.species).name}`
          });
          break;
        }
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
  const proteinCritical = agent.needs.proteinHunger < genome.thresholds.criticalHunger;
  const plantCritical = agent.needs.plantHunger < genome.thresholds.criticalHunger;
  // Priority hierarchy: drink(95) > eat from inventory(92) > hunt/forage(88) > search(83)
  // Eating from inventory is instant and most efficient — always prefer it
  const eatPrio = genome.interruptWeights.criticalHunger + 2; // 92
  const foragePrio = genome.interruptWeights.criticalHunger - 2; // 88
  const searchPrio = genome.interruptWeights.criticalHunger - 7; // 83

  // --- Critical PROTEIN hunger: eat meat or hunt ---
  if (proteinCritical) {
    if (agent.resources.meat > 0) {
      decisions.push({ action: 'eating', priority: eatPrio, reason: 'eating meat (starving)' });
    } else {
      // No meat — hunt is the only way to get protein (pushed below in hunt section with starvation boost)
      // Also try eating plant food as partial stopgap (gives 20% protein via omnivore cross-restore)
      if (agent.resources.food > 0) {
        decisions.push({ action: 'eating', priority: eatPrio - 3, reason: 'eating food (need protein)' });
      }
    }
  }

  // --- Critical PLANT hunger: eat food or forage ---
  if (plantCritical) {
    if (agent.resources.food > 0) {
      decisions.push({ action: 'eating', priority: eatPrio, reason: 'eating food (starving)' });
    } else if (agent.resources.meat > 0) {
      // Meat gives 20% plant hunger as omnivore stopgap
      decisions.push({ action: 'eating', priority: eatPrio - 3, reason: 'eating meat (need plants)' });
    } else {
      // No food — forage for plants
      const foodTypes: PlantType[] = [PlantType.BERRY_BUSH, PlantType.MUSHROOM, PlantType.HUNGER_HERB, PlantType.EDIBLE_FLOWER];
      if (!canIdentifyPoison(agent.skills) && Math.random() < 0.3) {
        foodTypes.push(PlantType.POISON_SHROOM);
      }
      const foodPlant = world.findNearestPlant(ax, ay, foodTypes);
      if (foodPlant) {
        decisions.push({
          action: 'harvesting',
          priority: foragePrio,
          target: { x: foodPlant.x, y: foodPlant.y },
          targetPlantId: foodPlant.id,
          reason: 'foraging for food (starving)'
        });
      } else {
        decisions.push({
          action: 'wandering',
          priority: searchPrio,
          target: { x: ax + (Math.random() > 0.5 ? 15 : -15), y: ay + (Math.random() > 0.5 ? 15 : -15) },
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
    // Eat to heal: health regens when hunger > 50 — eat food/meat to enable regen
    if (effectiveHunger < 55 && (agent.resources.food > 0 || agent.resources.meat > 0)) {
      const healEatPriority = agent.needs.health < genome.thresholds.criticalHealth
        ? genome.interruptWeights.lowHealth  // critical health: eat as urgently as healing
        : 55; // moderate health: eat above most tasks
      decisions.push({ action: 'eating', priority: healEatPriority, reason: 'eating to heal' });
    }
    // Drink to heal: health regens when thirst > 50
    if (agent.needs.thirst < 55) {
      const water = world.findNearest(ax, ay, TileType.WATER);
      if (water) {
        const healDrinkPriority = agent.needs.health < genome.thresholds.criticalHealth
          ? genome.interruptWeights.lowHealth
          : 55;
        decisions.push({
          action: 'drinking', priority: healDrinkPriority,
          target: water, reason: 'drinking to heal'
        });
      }
    }
  }

  if (agent.needs.stamina < genome.thresholds.criticalStamina) {
    // Check for stamina herb — only if close enough (walking drains more stamina)
    const herb = world.findNearestPlant(ax, ay, [PlantType.STAMINA_HERB], 15);
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
      // Been stuck for 3 seconds — delegate trapped-escape logic to BaseNeedsSystem
      (agent as any)._stuckTicks = 0;
      const stuckBeing: Being = {
        x: agent.x, y: agent.y, health: agent.needs.health,
        proteinHunger: agent.needs.proteinHunger, plantHunger: agent.needs.plantHunger,
        thirst: agent.needs.thirst, stamina: agent.needs.stamina,
        baseStats: agent.baseStats,
        skills: agent.skills as unknown as Record<string, { xp: number; level: number }>,
        alive: agent.alive, action: agent.action, attackCooldown: agent.attackCooldown,
      };
      const escapeDecision = baseEvaluateStuckEscape(stuckBeing, genome, world, 30);
      if (escapeDecision) {
        return {
          action: escapeDecision.action as AgentAction,
          priority: escapeDecision.priority,
          target: escapeDecision.target,
          reason: escapeDecision.reason,
        };
      }
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
    if (agent.resources.food > 0 || agent.resources.meat > 0) {
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
  // Also hunt when plant-hungry with no plant food — meat gives partial plant hunger
  const isStarving = agent.needs.proteinHunger < 15 || (agent.needs.plantHunger < 15 && agent.resources.food === 0);
  const needsFood = agent.needs.proteinHunger < genome.goalThresholds.proteinRelevant
    || (agent.needs.plantHunger < genome.thresholds.criticalHunger && agent.resources.food === 0);
  if (needsFood) {
    let bestHunt: { priority: number; animal: typeof world.animals[0]; species: ReturnType<typeof getSpecies>; dist: number } | null = null;
    for (const animal of world.animals) {
      if (!animal.alive) continue;
      if (animal.tamedBy === agent.id) continue; // never hunt your own tamed animals
      const species = getSpecies(animal.species);
      const dist = distance(agent.x, agent.y, animal.x, animal.y);
      if (dist > genome.thresholds.huntDetectRange) continue;

      const meatValue = species.drops?.meat ?? species.foodDrop ?? 0;
      if (meatValue === 0) continue;

      const myAttack = 10 + agent.skills.combat.level * 0.5;
      const riskScore = species.attack / Math.max(1, myAttack);
      const rewardScore = meatValue / 10; // scale: 1.0 = 10 meat (cow/bear), 0.5 = 5 meat
      const hungerUrgency = 1 - (agent.needs.proteinHunger / 100);
      // Slow prey is much more attractive — agents can actually catch them
      const speedAdvantage = Math.max(0, (0.3 - species.speed) * 50); // +5 priority per 0.1 slower than agent
      // Closer prey is preferred
      const distPenalty = dist * 0.5;

      // Starving agents fight anything — even bears — to survive
      if (!isStarving && riskScore > 2.0 && hungerUrgency < 0.7) continue;

      const huntBase = genome.fallbackWeights.huntAnimal;
      let huntPriority = Math.floor(huntBase + (rewardScore * hungerUrgency * 25) + speedAdvantage - (riskScore * 5) - distPenalty);

      // Starvation boost: hunt priority spikes when truly desperate
      if (isStarving) {
        huntPriority = Math.max(huntPriority, genome.interruptWeights.criticalHunger); // match critical hunger priority
      }

      if (huntPriority > 15 && (!bestHunt || huntPriority > bestHunt.priority)) {
        bestHunt = { priority: huntPriority, animal, species, dist };
      }
    }
    if (bestHunt) {
      decisions.push({
        action: 'harvesting',
        priority: bestHunt.priority + gatherBonus,
        target: { x: Math.floor(bestHunt.animal.x), y: Math.floor(bestHunt.animal.y) },
        targetAnimalId: bestHunt.animal.id,
        reason: isStarving ? `desperate hunt: ${bestHunt.species.name}` : `hunting ${bestHunt.species.name}`
      });
    }
  }

  // --- Harvest nearby corpses for materials/meat (always check — free food!) ---
  {
    const corpseRange = agent.needs.proteinHunger < 20 ? 40 : genome.thresholds.corpseDetectRange;
    const corpse = world.findNearestCorpse(ax, ay, corpseRange);
    if (corpse) {
      // Priority scales with hunger — starving agents rush to corpses
      let corpsePriority = genome.fallbackWeights.harvestCorpse;
      if (agent.needs.proteinHunger < 20) corpsePriority = Math.max(corpsePriority, 75); // starving: high priority
      else if (agent.needs.proteinHunger < 40) corpsePriority = Math.max(corpsePriority, 60); // hungry: medium-high
      decisions.push({
        action: 'harvesting',
        priority: corpsePriority,
        target: { x: Math.floor(corpse.x), y: Math.floor(corpse.y) },
        targetCorpseId: corpse.id,
        reason: 'scavenging corpse'
      });
    }
  }

  // --- Desperate: hunt other agents for food when starving ---
  // Only when protein is critically low AND no animal hunt or corpse was found
  if (isStarving && !decisions.some(d => d.reason?.includes('hunt') || d.reason?.includes('corpse'))) {
    // Find weakest nearby agent
    let weakestAgent: AgentState | null = null;
    let weakestPower = Infinity;
    for (const other of allAgents) {
      if (other.id === agent.id || !other.alive) continue;
      const d = distance(agent.x, agent.y, other.x, other.y);
      if (d > genome.thresholds.huntDetectRange) continue;
      const otherPower = Object.values(other.skills).reduce((sum, s) => sum + s.level, 0);
      // Prefer weaker targets, or sleeping/resting agents
      const effectivePower = (other.action === 'resting' || other.action === 'idle') ? otherPower * 0.5 : otherPower;
      if (effectivePower < weakestPower) {
        weakestPower = effectivePower;
        weakestAgent = other;
      }
    }
    if (weakestAgent) {
      decisions.push({
        action: 'harvesting',
        priority: 70, // below critical survival but above medium needs
        target: { x: Math.floor(weakestAgent.x), y: Math.floor(weakestAgent.y) },
        targetAgentId: weakestAgent.id,
        reason: `desperate: hunting ${weakestAgent.name} for food`
      });
    }
  }

  // --- Stockpile food: gather berries for inventory ---
  const totalFood = agent.resources.food + agent.resources.meat;
  const foodTarget = genome.thresholds.foodTarget ?? 6;
  if (totalFood < foodTarget) {
    const berryBush = world.findNearestPlant(ax, ay, [PlantType.BERRY_BUSH, PlantType.EDIBLE_FLOWER]);
    if (berryBush) {
      const urgentPriority = genome.thresholds.stockpileUrgent ?? 50;
      const stockPriority = totalFood === 0 ? urgentPriority : totalFood < foodTarget / 2 ? urgentPriority - 10 : urgentPriority - 20;
      decisions.push({
        action: 'harvesting',
        priority: stockPriority + gatherBonus,
        target: { x: berryBush.x, y: berryBush.y },
        targetPlantId: berryBush.id,
        reason: 'gathering food for later'
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
  if (agent.resources.wood < (genome.thresholds.woodTarget ?? genome.thresholds.woodMinimum)) {
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

  if (agent.resources.stone < (genome.thresholds.stoneTarget ?? genome.thresholds.stoneMinimum)) {
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
  // Two motivations: (1) shelter need drives campfire, (2) settlement progression drives upgrades
  {
    const hasShelterNeed = agent.needs.shelter < genome.goalThresholds.shelterRelevant;
    // Check if agent already owns a campfire nearby — don't spam more campfires
    const ownsCampfireNearby = world.structures.some(s =>
      s.tileType === TileType.CAMPFIRE && s.ownerId === agent.id
      && distance(ax, ay, s.x, s.y) < 10
    );
    // Settlement progression: agent with own campfire should build workbench, walls, etc.
    const wantsToSettle = ownsCampfireNearby && agent.resources.wood >= 3;

    if ((hasShelterNeed && agent.resources.wood >= 3) || wantsToSettle) {
      const canBuild = NEW_RECIPES.some(r => {
        if (r.skillType !== 'building' || r.produces.type !== 'tile') return false;
        if (agent.skills.building.level < r.skillRequired) return false;
        const pt = r.produces.tileType as TileType;
        // Skip campfire if agent already owns one nearby
        if (pt === TileType.CAMPFIRE && ownsCampfireNearby) return false;
        // Don't build workbench/forge duplicates within 5 tiles
        if ((pt === TileType.WORKBENCH || pt === TileType.FORGE)
          && world.findNearest(ax, ay, pt, 5) !== null) return false;
        if (r.station === 'workbench' && !isAdjacentToTile(ax, ay, TileType.WORKBENCH, world)) return false;
        if (r.station === 'forge' && !isAdjacentToTile(ax, ay, TileType.FORGE, world)) return false;
        return Object.entries(r.requires).every(([res, amt]) => ((agent.resources as any)[res] || 0) >= amt);
      });
      if (canBuild) {
        const shelterUrgency = agent.needs.shelter < 15 ? 20 : agent.needs.shelter < 30 ? 10 : 0;
        // Shelter-driven campfire gets high priority; settlement upgrades get moderate priority
        const basePriority = hasShelterNeed && !ownsCampfireNearby ? 45 + shelterUrgency : 30;
        decisions.push({
          action: 'building',
          priority: basePriority + (agent.skills.building.level / 5),
          target: { x: ax, y: ay },
          reason: hasShelterNeed && !ownsCampfireNearby ? 'needs shelter' : 'expanding settlement'
        });
      }
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

  // --- Planting (long-term food/resource investment) ---
  if (agent.resources.treeSeed > 0 && agent.resources.wood > genome.thresholds.woodToKeepBeforePlanting) {
    const plantSpot = world.findNearestPlantable(ax, ay);
    if (plantSpot) {
      decisions.push({
        action: 'planting',
        priority: genome.fallbackWeights.plantSeeds + gatherBonus,
        target: plantSpot,
        reason: 'planting a tree seed'
      });
    }
  }
  if (agent.resources.plantSeed > 0) {
    // Plant food seeds whenever agent has them — food plants are always valuable
    // Priority boost when hungry (investment is more urgent)
    const plantBoost = agent.needs.plantHunger < 40 ? 15 : agent.needs.plantHunger < 60 ? 8 : 0;
    const plantSpot = world.findNearestPlantable(ax, ay);
    if (plantSpot) {
      decisions.push({
        action: 'planting',
        priority: genome.fallbackWeights.plantSeeds + 5 + plantBoost + gatherBonus,
        target: plantSpot,
        reason: 'planting a food plant'
      });
    }
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

  // --- Taming nearby animals (max 5 tamed per agent) ---
  // Taming is a long-term food strategy: tamed animals produce drops automatically.
  // Priority scales with tameAnimal genome weight and hunger — agents with few tamed animals
  // and low food should prioritize taming over hunting for sustainable supply.
  const tamedCount = world.animals.filter(a => a.alive && a.tamedBy === agent.id).length;
  if (tamedCount < cfg.taming.maxPerAgent && genome.fallbackWeights.tameAnimal > 10) {
    const tameRange = 8 + agent.skills.social.level * 0.1; // 8-18 tiles
    const foodSecurityBonus = tamedCount === 0 ? 15 : (tamedCount < 3 ? 8 : 0); // more urgent when no tamed animals
    let bestTameTarget: { animal: typeof world.animals[0]; species: ReturnType<typeof getSpecies>; priority: number } | null = null;
    for (const animal of world.animals) {
      if (!animal.alive || animal.tamed) continue;
      const species = getSpecies(animal.species);
      if (!species.tameable) continue;
      const dist = distance(agent.x, agent.y, animal.x, animal.y);
      if (dist > tameRange) continue;
      if (agent.resources.food <= 0 && agent.resources.meat <= 0) break; // need food to tame
      // Priority: base weight + food security bonus + meat production value
      const meatProduction = (species.drops?.meat ?? species.foodDrop ?? 0) * 0.3;
      let tamePriority = genome.fallbackWeights.tameAnimal + foodSecurityBonus + Math.floor(meatProduction * 3);
      // Hunger urgency: when hungry, taming is more attractive for sustainable food
      if (agent.needs.proteinHunger < 40) tamePriority += 10;
      if (!bestTameTarget || tamePriority > bestTameTarget.priority) {
        bestTameTarget = { animal, species, priority: tamePriority };
      }
    }
    if (bestTameTarget) {
      decisions.push({
        action: 'socializing',
        priority: bestTameTarget.priority + gatherBonus,
        target: { x: Math.floor(bestTameTarget.animal.x), y: Math.floor(bestTameTarget.animal.y) },
        targetAnimalId: bestTameTarget.animal.id,
        reason: `taming ${bestTameTarget.species.name} (${tamedCount}/5)`
      });
    }
  }

  // --- Follow alliance leader ---
  // Allied agents walk together. Leader = highest total skill levels (ties: highest effectiveness/score).
  // Non-leaders follow the leader with moderate priority (above wander, below survival).
  const myAlliance = agent.allies ?? [];
  if (myAlliance.length > 0) {
    // Gather all living alliance members including self
    const allianceGroup = [agent, ...allAgents.filter(a => a.alive && myAlliance.includes(a.id))];
    // Determine leader: highest total skill levels, then most lives remaining as tiebreaker
    let leader = allianceGroup[0];
    for (const member of allianceGroup) {
      const memberLevels = Object.values(member.skills).reduce((sum, s) => sum + s.level, 0);
      const leaderLevels = Object.values(leader.skills).reduce((sum, s) => sum + s.level, 0);
      if (memberLevels > leaderLevels || (memberLevels === leaderLevels && (member.livesRemaining ?? 0) > (leader.livesRemaining ?? 0))) {
        leader = member;
      }
    }
    // Non-leaders follow the leader — but survival needs take priority
    if (leader.id !== agent.id) {
      const hasUrgentNeed = agent.needs.thirst < 40 || agent.needs.plantHunger < 40 || agent.needs.proteinHunger < 40;
      const leaderDist = distance(agent.x, agent.y, leader.x, leader.y);
      if (leaderDist > 3 && !hasUrgentNeed) {
        // Follow with priority scaling by distance — farther = more urgent
        const followPriority = Math.min(45, 25 + leaderDist * 1.5);
        decisions.push({
          action: 'moving_to',
          priority: followPriority,
          target: { x: Math.floor(leader.x), y: Math.floor(leader.y) },
          reason: `following ally ${leader.name}`
        });
      }
    }

    // Leaders (and all agents): wait for allies/pets with urgent survival needs
    // Check if any nearby ally or tamed animal is eating/drinking
    const allyBusy = allianceGroup.some(m =>
      m.id !== agent.id && distance(agent.x, agent.y, m.x, m.y) < 15
      && (m.needs.thirst < 40 || m.needs.plantHunger < 40 || m.needs.proteinHunger < 40)
    );
    const petBusy = world.animals.some(a =>
      a.alive && a.tamedBy === agent.id
      && distance(agent.x, agent.y, a.x, a.y) < 15
      && (a.thirst < 40 || a.plantHunger < 40 || a.proteinHunger < 40)
    );
    if (allyBusy || petBusy) {
      // Wait in place — suppress wander so agent doesn't walk away
      decisions.push({
        action: 'idle',
        priority: 20, // above default wander but below any real task
        target: { x: ax, y: ay },
        reason: allyBusy ? 'waiting for ally' : 'waiting for pet'
      });
    }
  }

  // Wait for tamed animals with urgent needs (for agents without alliances)
  if (myAlliance.length === 0) {
    const petBusy = world.animals.some(a =>
      a.alive && a.tamedBy === agent.id
      && distance(agent.x, agent.y, a.x, a.y) < 15
      && (a.thirst < 40 || a.plantHunger < 40 || a.proteinHunger < 40)
    );
    if (petBusy) {
      decisions.push({
        action: 'idle',
        priority: 20,
        target: { x: ax, y: ay },
        reason: 'waiting for pet'
      });
    }
  }

  // --- Default: wander ---
  decisions.push({
    action: 'wandering',
    priority: genome.fallbackWeights.wander,
    reason: 'exploring'
  });

  // --- Archetype urges: periodic role-specific impulses ---
  // Every 100 ticks (~10s), archetype-specific instinct fires with moderate priority.
  // These define the "personality" of each class beyond just weight tuning.
  if (tickCount % 100 < 2) { // fires for 2 ticks every 100 (gives time to start action)
    const archetype = agent.archetype ?? 'random';
    const totalLevels = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);

    switch (archetype) {
      case 'warrior': {
        // Urge to Fight: seek combat with nearest animal or agent
        const huntRange = genome.thresholds.huntDetectRange + 5;
        let bestTarget: { x: number; y: number; id: string; isAgent: boolean; priority: number } | null = null;
        for (const animal of world.animals) {
          if (!animal.alive || animal.tamedBy === agent.id) continue;
          const d = distance(agent.x, agent.y, animal.x, animal.y);
          if (d > huntRange) continue;
          const spec = getSpecies(animal.species);
          if (spec.attack < 3) continue; // ignore tiny prey — warriors want a real fight
          const pri = 50 + Math.min(20, spec.attack);
          if (!bestTarget || pri > bestTarget.priority) {
            bestTarget = { x: Math.floor(animal.x), y: Math.floor(animal.y), id: animal.id, isAgent: false, priority: pri };
          }
        }
        if (bestTarget) {
          decisions.push({
            action: 'harvesting', priority: bestTarget.priority,
            target: { x: bestTarget.x, y: bestTarget.y },
            targetAnimalId: bestTarget.id,
            reason: `urge to fight`
          });
        }
        break;
      }

      case 'survivor': {
        // Urge to Hoard: gather extra resources even when above thresholds
        if (agent.resources.wood < genome.thresholds.woodTarget * 2) {
          const tree = world.findNearestTree(ax, ay);
          if (tree) {
            decisions.push({
              action: 'harvesting', priority: 38,
              target: { x: tree.x, y: tree.y }, reason: `urge to hoard wood`
            });
          }
        }
        if (agent.resources.meat < 8) {
          decisions.push({
            action: 'harvesting', priority: 35,
            target: undefined, reason: `urge to stockpile food`
          });
        }
        break;
      }

      case 'builder': {
        // Urge to Build: construct structures even when shelter is fine
        if (agent.resources.wood >= 5 && agent.resources.stone >= 3) {
          decisions.push({
            action: 'building', priority: 42,
            target: { x: ax, y: ay }, reason: `urge to build`
          });
        } else {
          // Urge to gather building materials
          const rock = world.findNearestRock(ax, ay);
          if (rock && agent.resources.stone < 10) {
            decisions.push({
              action: 'harvesting', priority: 38,
              target: { x: rock.x, y: rock.y }, reason: `urge to quarry`
            });
          }
        }
        break;
      }

      case 'scout': {
        // Urge to Explore: wander far from current position
        const exploreRange = 15 + Math.floor(agent.skills.athletics.level / 5);
        const randX = clamp(ax + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * exploreRange), 0, WORLD_WIDTH - 1);
        const randY = clamp(ay + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * exploreRange), 0, WORLD_HEIGHT - 1);
        decisions.push({
          action: 'moving_to', priority: 35,
          target: { x: randX, y: randY }, reason: `urge to explore`
        });
        break;
      }

      case 'social': {
        // Urge to Befriend: seek out agents to socialize, or animals to tame
        const nearAgent = allAgents.find(a => a.id !== agent.id && a.alive && distance(agent.x, agent.y, a.x, a.y) < 25);
        if (nearAgent) {
          decisions.push({
            action: 'socializing', priority: 42,
            target: { x: Math.floor(nearAgent.x), y: Math.floor(nearAgent.y) },
            reason: `urge to befriend ${nearAgent.name}`
          });
        } else {
          // No agents nearby — seek animal to tame
          const tamedCount = world.animals.filter(a => a.alive && a.tamedBy === agent.id).length;
          if (tamedCount < cfg.taming.maxPerAgent) {
            for (const animal of world.animals) {
              if (!animal.alive || animal.tamed) continue;
              const spec = getSpecies(animal.species);
              if (!spec.tameable) continue;
              const d = distance(agent.x, agent.y, animal.x, animal.y);
              if (d < 20 && (agent.resources.food > 0 || agent.resources.meat > 0)) {
                decisions.push({
                  action: 'socializing', priority: 40,
                  target: { x: Math.floor(animal.x), y: Math.floor(animal.y) },
                  targetAnimalId: animal.id,
                  reason: `urge to tame ${spec.name}`
                });
                break;
              }
            }
          }
        }
        break;
      }
    }
  }

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
      // Diet-aware eating: agents are omnivores, any food partially fills both hungers
      if (agent.needs.proteinHunger < agent.needs.plantHunger && agent.resources.meat > 0) {
        agent.resources.meat -= 1;
        agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + EAT_RESTORE, 0, 100);
        agent.needs.plantHunger = clamp(agent.needs.plantHunger + EAT_RESTORE * 0.2, 0, 100);
      } else if (agent.resources.food > 0) {
        agent.resources.food -= 1;
        agent.needs.plantHunger = clamp(agent.needs.plantHunger + EAT_RESTORE * 0.7, 0, 100);
        agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + EAT_RESTORE * 0.3, 0, 100);
      } else if (agent.resources.meat > 0) {
        agent.resources.meat -= 1;
        agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + EAT_RESTORE, 0, 100);
        agent.needs.plantHunger = clamp(agent.needs.plantHunger + EAT_RESTORE * 0.2, 0, 100);
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
              agent.resources.wood += Math.floor(result.harvested);
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
              agent.resources.stone += Math.floor(result.harvested);
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
                    agent.resources.food += Math.floor(result.harvested);
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
                agent.attackCooldown = Math.max(cfg.combat.attackCooldownMin, cfg.combat.attackCooldownBase - Math.floor(agent.skills.combat.level / cfg.combat.attackCooldownSkillDiv));

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
                // Both sides gain XP from combat
                const diffMod = clamp(preySpecies.attack / Math.max(1, 10 + agent.skills.combat.level * 0.5), 0.5, 3.0);
                awardXP(agent.skills, 'combat', 3.0, diffMod);
                awardXP(prey.skills, 'defense', 2.0, Math.min(3.0, damage / 5));
                // Combat is a social experience — adrenaline, shared danger
                agent.needs.social = clamp(agent.needs.social + 2, 0, 100);
                // Mark animal as attacked by this agent
                prey.lastAttackedBy = { type: 'agent', id: agent.id, tick: agent.age };
                if (prey.health <= 0) {
                  prey.alive = false;
                  prey.action = 'dying';
                  agent.resources.food += preySpecies.foodDrop;
                  agent.needs.proteinHunger = clamp(agent.needs.proteinHunger + preySpecies.foodDrop * 5, 0, 100);
                  // Omnivore agents get partial plant hunger from fresh kill
                  agent.needs.plantHunger = clamp(agent.needs.plantHunger + preySpecies.foodDrop * 1.5, 0, 100);
                }
              } else {
                moveTowards(agent, prey.x, prey.y, world);
              }
            }
          } else if (decision.targetAgentId) {
            // Fighting another agent
            const isCannibalistic = decision.reason?.includes('for food');
            const targetAgent = allAgents.find(a => a.id === decision.targetAgentId && a.alive);
            if (targetAgent) {
              const d2 = distance(agent.x, agent.y, targetAgent.x, targetAgent.y);
              if (d2 <= 1.5) {
                // Attack cooldown
                if (agent.attackCooldown > 0) break;
                agent.attackCooldown = Math.max(5, 10 - Math.floor(agent.skills.combat.level / 20));

                // Calculate damage using proper stat-based formula
                let weaponBonus = 0;
                const weapon = agent.inventory.equipped.mainHand;
                if (weapon) {
                  const wDef = getItemDef(weapon.itemId);
                  weaponBonus = wDef.attackBonus || 0;
                }
                // Use getAttackDamage for consistent damage calc (includes accuracy roll)
                let damage = getAttackDamage(agent.baseStats, agent.skills, 10 + weaponBonus);
                // Athletics adds burst damage (agility-based striking)
                damage += agent.skills.athletics.level * 0.1;
                // Target's defense reduces damage
                const targetDefReduction = getDamageReduction(targetAgent.skills);
                damage = Math.max(1, Math.floor(damage * (1 - targetDefReduction)));

                targetAgent.needs.health = clamp(targetAgent.needs.health - damage, 0, 100);
                targetAgent.lastAttackedBy = { type: 'agent', id: agent.id, tick: agent.age };
                agent.lastAttackedBy = undefined;

                // Cannibalism: all witnesses become permanent enemies
                if (isCannibalistic) {
                  for (const witness of allAgents) {
                    if (witness.id === agent.id || !witness.alive) continue;
                    const witnessDist = distance(agent.x, agent.y, witness.x, witness.y);
                    if (witnessDist < 15) {
                      // Witness marks cannibal as foe permanently
                      const dispKey = witness.id + '>' + agent.id;
                      agentDisposition.set(dispKey, 'foe');
                      witness.relationships[agent.id] = -100;
                    }
                  }
                }

                awardXP(agent.skills, 'combat', 1.5);
                awardXP(targetAgent.skills, 'defense', 1.0);
                agent.needs.social = clamp(agent.needs.social + 2, 0, 100);
                targetAgent.needs.social = clamp(targetAgent.needs.social + 1, 0, 100);

                if (targetAgent.needs.health <= 0) {
                  targetAgent.alive = false;
                  targetAgent.action = 'dying';
                  // Major reward for killing another agent
                  const cc = cfg.combat;
                  if (agent.livesRemaining !== undefined) {
                    agent.livesRemaining = Math.min(cc.maxLives, (agent.livesRemaining ?? 100) + cc.killBonusLives);
                  }
                  const victimLevel = Object.values(targetAgent.skills).reduce((sum, s) => sum + s.level, 0);
                  const difficultyMod = Math.max(1.0, victimLevel / 10);
                  awardXP(agent.skills, 'combat', cc.killXP.combat, difficultyMod);
                  awardXP(agent.skills, 'defense', cc.killXP.defense, difficultyMod);
                  awardXP(agent.skills, 'athletics', cc.killXP.athletics, difficultyMod);
                  awardXP(agent.skills, 'survival', cc.killXP.survival, difficultyMod);
                  // Loot victim resources
                  agent.resources.food += Math.floor(targetAgent.resources.food * cc.lootFractions.food);
                  agent.resources.meat += Math.floor(targetAgent.resources.meat * cc.lootFractions.meat);
                  agent.resources.wood += Math.floor(targetAgent.resources.wood * cc.lootFractions.wood);
                  agent.resources.stone += Math.floor(targetAgent.resources.stone * cc.lootFractions.stone);
                }
              } else {
                moveTowards(agent, targetAgent.x, targetAgent.y, world);
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
      const ownsNearCampfire = world.structures.some(s =>
        s.tileType === TileType.CAMPFIRE && s.ownerId === agent.id
        && distance(ax, ay, s.x, s.y) < 10
      );
      const buildRecipe = NEW_RECIPES.find(r => {
        if (r.skillType !== 'building') return false;
        if (r.produces.type !== 'tile') return false;
        const skillLevel = agent.skills.building.level;
        if (skillLevel < r.skillRequired) return false;
        const producedTile = r.produces.tileType as TileType;
        // Skip campfire if agent already owns one nearby
        if (producedTile === TileType.CAMPFIRE && ownsNearCampfire) return false;
        // Don't build workbench/forge duplicates within 5 tiles
        if ((producedTile === TileType.WORKBENCH || producedTile === TileType.FORGE)
          && world.findNearest(ax, ay, producedTile, 5) !== null) return false;
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
            const totalMats = Object.values(buildRecipe.requires).reduce((s, n) => s + n, 0);
            awardXP(agent.skills, 'building', 10.0 + totalMats * 5);
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

        // Award XP scaled to recipe complexity
        const craftMats = Object.values(craftRecipe.requires).reduce((s, n) => s + n, 0);
        awardXP(agent.skills, craftRecipe.skillType === 'crafting' ? 'crafting' : 'building', 10.0 + craftMats * 5);
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
              // Big XP reward for successful taming — harder animals give more
              awardXP(agent.skills, 'social', 30.0, species.tamingCost);
              awardXP(agent.skills, 'survival', 15.0, species.tamingCost);
              interactions.push({ agentA: agent.id, agentB: '', type: 'tamed', outcome: 0, timestamp: Date.now(), details: { species: species.name, animalId: animal.id } });
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
            // Interaction cooldown: once per second (10 ticks) per pair
            const pairKey = [agent.id, nearbyAgent.id].sort().join(':');
            const lastInteraction = socialCooldowns.get(pairKey) ?? 0;
            if (agent.age - lastInteraction < 5) { /* cooldown — stay in socializing but skip interaction */ }
            else {
            socialCooldowns.set(pairKey, agent.age);

            // Each agent decides independently: friend or foe (on first meeting, persists until death)
            const dispKey = agent.id + '>' + nearbyAgent.id;
            if (!agentDisposition.has(dispKey)) {
              const relationship = agent.relationships[nearbyAgent.id] ?? 0;
              const isSocial = agent.personality.includes('social');
              const isLoner = agent.personality.includes('loner');
              const totalLevels = Object.values(agent.skills).reduce((sum, s) => sum + s.level, 0);
              let friendChance = 0.7;
              if (isSocial) friendChance += 0.15;
              if (isLoner) friendChance -= 0.25;
              friendChance += relationship * 0.002;
              // Higher level = more aggressive: 10% foe at lv0 → 50% foe at ~200 total levels
              friendChance -= totalLevels * 0.002; // -40% at 200 total levels
              friendChance = Math.max(0.1, Math.min(0.95, friendChance));
              agentDisposition.set(dispKey, Math.random() < friendChance ? 'friend' : 'foe');
            }

            const disposition = agentDisposition.get(dispKey)!;

            if (disposition === 'friend') {
              // Chat: restore social, build relationship
              const outcome = randomOutcome(3, 8);
              agent.needs.social = clamp(agent.needs.social + SOCIAL_RESTORE, 0, 100);
              nearbyAgent.needs.social = clamp(nearbyAgent.needs.social + SOCIAL_RESTORE * 0.5, 0, 100);
              agent.relationships[nearbyAgent.id] = clamp((agent.relationships[nearbyAgent.id] ?? 0) + outcome, -100, 100);
              nearbyAgent.relationships[agent.id] = clamp((nearbyAgent.relationships[agent.id] ?? 0) + outcome * 0.5, -100, 100);
              awardXP(agent.skills, 'social', 1.0);
              agent.socialScore++;
              interactions.push({ agentA: agent.id, agentB: nearbyAgent.id, type: 'conversation', outcome, timestamp: Date.now() });
              // Friendly health/stamina boost
              if (agent.needs.thirst > 10 && agent.needs.proteinHunger > 10) {
                agent.needs.health = clamp(agent.needs.health + 1, 0, 100);
                agent.needs.stamina = clamp(agent.needs.stamina + 2, 0, 100);
              }

              // Alliance formation: strong friends become allies (max 3 per agent)
              // Self-sufficient agents with many tamed animals are less likely to ally
              const myAllies = agent.allies ?? [];
              const theirAllies = nearbyAgent.allies ?? [];
              const relationship = agent.relationships[nearbyAgent.id] ?? 0;
              const reverseRelation = nearbyAgent.relationships[agent.id] ?? 0;
              const myTamedCount = world.animals.filter(a => a.alive && a.tamedBy === agent.id).length;
              const theirTamedCount = world.animals.filter(a => a.alive && a.tamedBy === nearbyAgent.id).length;
              const ac = cfg.alliance;
              const myThreshold = ac.baseRelationThreshold + myTamedCount * ac.tamedAnimalPenalty;
              const theirThreshold = (ac.baseRelationThreshold - 20) + theirTamedCount * ac.tamedAnimalPenalty;
              if (relationship >= myThreshold && reverseRelation >= theirThreshold
                  && myAllies.length < ac.maxAllies && theirAllies.length < ac.maxAllies
                  && !myAllies.includes(nearbyAgent.id)) {
                if (!agent.allies) agent.allies = [];
                if (!nearbyAgent.allies) nearbyAgent.allies = [];
                agent.allies.push(nearbyAgent.id);
                nearbyAgent.allies.push(agent.id);
                // XP reward for forming alliance — social milestone
                awardXP(agent.skills, 'social', 50.0);
                awardXP(nearbyAgent.skills, 'social', 50.0);
                awardXP(agent.skills, 'survival', 20.0);
                awardXP(nearbyAgent.skills, 'survival', 20.0);
                interactions.push({ agentA: agent.id, agentB: nearbyAgent.id, type: 'alliance', outcome: 0, timestamp: Date.now() });
              }

              // Alliance resource sharing: help starving/dehydrated ally
              if (myAllies.includes(nearbyAgent.id)) {
                const ac = cfg.alliance;
                if (nearbyAgent.needs.proteinHunger < ac.shareCriticalNeed && agent.resources.meat > ac.shareMinSurplus) {
                  const share = Math.min(ac.shareAmount, agent.resources.meat - 1);
                  agent.resources.meat -= share;
                  nearbyAgent.resources.meat += share;
                  nearbyAgent.needs.proteinHunger = clamp(nearbyAgent.needs.proteinHunger + share * 10, 0, 100);
                }
                if (nearbyAgent.needs.plantHunger < ac.shareCriticalNeed && agent.resources.food > ac.shareMinSurplus) {
                  const share = Math.min(ac.shareAmount, agent.resources.food - 1);
                  agent.resources.food -= share;
                  nearbyAgent.resources.food += share;
                  nearbyAgent.needs.plantHunger = clamp(nearbyAgent.needs.plantHunger + share * 8, 0, 100);
                }
              }
            } else {
              // Fight: deal damage using proper stat formula
              let damage = getAttackDamage(agent.baseStats, agent.skills, 10);
              damage += agent.skills.athletics.level * 0.1;
              const foeDefReduction = getDamageReduction(nearbyAgent.skills);
              damage = Math.max(1, Math.floor(damage * (1 - foeDefReduction)));
              nearbyAgent.needs.health = clamp(nearbyAgent.needs.health - damage, 0, 100);
              nearbyAgent.lastAttackedBy = { type: 'agent', id: agent.id, tick: agent.age };
              agent.relationships[nearbyAgent.id] = clamp((agent.relationships[nearbyAgent.id] ?? 0) - 10, -100, 100);
              nearbyAgent.relationships[agent.id] = clamp((nearbyAgent.relationships[agent.id] ?? 0) - 15, -100, 100);
              awardXP(agent.skills, 'combat', 0.5);
              awardXP(nearbyAgent.skills, 'defense', 0.3);
              agent.socialScore--;
              interactions.push({ agentA: agent.id, agentB: nearbyAgent.id, type: 'conflict', outcome: -damage, timestamp: Date.now() });
            }

            // Trading: charisma-scaled chance to swap surplus resources
            // High CHA agents trade more often and get better deals
            const tradeChance = 0.1 + (agent.baseStats.charisma * 0.02); // 10-38% based on CHA
            if (Math.random() < tradeChance && disposition === 'friend') {
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
            } // end else (cooldown passed)
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
      const target = decision.target!;
      const d = distance(agent.x, agent.y, target.x, target.y);
      if (d <= 1.5) {
        // Close enough — plant at target tile
        if (agent.resources.plantSeed > 0 && decision.reason?.includes('food plant')) {
          const plant = world.plantFoodSeed(target.x, target.y, PlantType.BERRY_BUSH);
          if (plant) {
            agent.resources.plantSeed -= 1;
            awardXP(agent.skills, 'foraging', 1.0);
          }
        } else if (agent.resources.treeSeed > 0) {
          const result = world.plantSeed(target.x, target.y);
          if (result) {
            agent.resources.treeSeed -= 1;
            tileChanges.push(...result.tileChanges);
            awardXP(agent.skills, 'foraging', 1.0);
          }
        }
      } else {
        // Walk toward plantable tile
        moveTowards(agent, target.x, target.y, world);
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
