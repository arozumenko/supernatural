import type { AgentState, PlanCondition, PlanStep, ActivePlan } from '../../shared/src/index.ts';
import { distance, TileType } from '../../shared/src/index.ts';
import type { World } from '../World.ts';
import { getSpecies } from '../AnimalSpeciesConfig.ts';
import { recordLifeEvent } from '../ai/LifeJournal.ts';

/**
 * Execute pending plan logic for an agent.
 * Called from decideAction() between interrupt check and GOAP layer.
 * Returns a decision to push, or null if plan doesn't produce one this tick.
 */
export function executePendingPlan(
  agent: AgentState,
  world: World,
  tickCount: number
): { action: string; priority: number; target?: { x: number; y: number }; reason: string } | null {
  const plan: ActivePlan | undefined = (agent as any).pendingPlan;
  if (!plan) return null;

  // Check expiry
  if (tickCount >= plan.expiresAtTick) {
    recordLifeEvent(agent, 'plan_completed', `Plan "${plan.name}" expired`, undefined, tickCount);
    (agent as any).pendingPlan = undefined;
    return null;
  }

  // Check danger abandonment
  if (plan.abandonOnDanger && hasNearbyThreat(agent, world)) {
    recordLifeEvent(agent, 'plan_abandoned', `Plan "${plan.name}" abandoned due to danger`, undefined, tickCount);
    (agent as any).pendingPlan = undefined;
    return null;
  }

  // Get current step
  const step = plan.steps[plan.currentStep];
  if (!step) {
    // Plan complete — all steps done
    recordLifeEvent(agent, 'plan_completed', `Plan "${plan.name}" finished`, undefined, tickCount);
    (agent as any).pendingPlan = undefined;
    return null;
  }

  // Check step completion condition
  if (step.condition && evaluatePlanCondition(step.condition, agent, tickCount - plan.stepStartTick)) {
    plan.currentStep++;
    plan.stepStartTick = tickCount;
    // Check if that was the last step
    if (plan.currentStep >= plan.steps.length) {
      recordLifeEvent(agent, 'plan_completed', `Plan "${plan.name}" finished`, undefined, tickCount);
      (agent as any).pendingPlan = undefined;
      return null;
    }
    return executePendingPlan(agent, world, tickCount); // Recurse for next step
  }

  // Check step timeout
  if (step.maxTicks && (tickCount - plan.stepStartTick) > step.maxTicks) {
    plan.currentStep++;
    plan.stepStartTick = tickCount;
    if (plan.currentStep >= plan.steps.length) {
      recordLifeEvent(agent, 'plan_completed', `Plan "${plan.name}" finished (step timed out)`, undefined, tickCount);
      (agent as any).pendingPlan = undefined;
      return null;
    }
    return executePendingPlan(agent, world, tickCount);
  }

  // Execute current step
  const target = resolvePlanTarget(step, agent, world);
  return {
    action: step.action,
    priority: plan.priority,
    target: target ?? undefined,
    reason: `plan: ${plan.name} step ${plan.currentStep + 1}/${plan.steps.length}`,
  };
}

export function evaluatePlanCondition(
  condition: PlanCondition,
  agent: AgentState,
  ticksSinceStep: number
): boolean {
  switch (condition.type) {
    case 'resource_above': {
      const val = (agent.resources as any)[condition.field ?? ''];
      return typeof val === 'number' && val >= (condition.value ?? 0);
    }
    case 'need_above': {
      const val = (agent.needs as any)[condition.field ?? ''];
      return typeof val === 'number' && val >= (condition.value ?? 0);
    }
    case 'at_position': {
      if (!condition.position) return false;
      const d = distance(agent.x, agent.y, condition.position.x, condition.position.y);
      return d <= (condition.position.radius ?? 1);
    }
    case 'item_crafted': {
      // Check if agent has the item
      return agent.inventory.items.some(i => i.itemId === condition.field);
    }
    case 'ticks_elapsed': {
      return ticksSinceStep >= (condition.value ?? 0);
    }
    default:
      return false;
  }
}

function resolvePlanTarget(
  step: PlanStep,
  agent: AgentState,
  world: World
): { x: number; y: number } | null {
  if (!step.target) return null;
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);

  switch (step.target.type) {
    case 'position':
      return { x: step.target.x ?? ax, y: step.target.y ?? ay };

    case 'nearest': {
      const rt = step.target.resourceType;
      if (rt === 'water') {
        return world.findNearest(ax, ay, TileType.WATER);
      }
      if (rt === 'tree') {
        const tree = world.findNearestTree(ax, ay);
        return tree ? { x: tree.x, y: tree.y } : null;
      }
      if (rt === 'rock' || rt === 'stone') {
        const rock = world.findNearestRock(ax, ay);
        return rock ? { x: rock.x, y: rock.y } : null;
      }
      if (rt === 'iron_ore') {
        return world.findNearest(ax, ay, TileType.IRON_ORE);
      }
      return null;
    }

    case 'entity': {
      // Find entity by ID in world
      const eid = step.target.entityId;
      if (!eid) return null;
      const animal = world.animals.find(a => a.id === eid);
      if (animal) return { x: Math.floor(animal.x), y: Math.floor(animal.y) };
      const tree = world.trees.find(t => t.id === eid);
      if (tree) return { x: tree.x, y: tree.y };
      const rock = world.rocks.find(r => r.id === eid);
      if (rock) return { x: rock.x, y: rock.y };
      return null;
    }

    case 'resource':
      return { x: step.target.x ?? ax, y: step.target.y ?? ay };

    default:
      return null;
  }
}

export function hasNearbyThreat(agent: AgentState, world: World): boolean {
  const ax = agent.x;
  const ay = agent.y;
  const detectRange = 8;

  for (const animal of world.animals) {
    if (!animal.alive) continue;
    const d = distance(ax, ay, animal.x, animal.y);
    if (d > detectRange) continue;
    const species = getSpecies(animal.species);
    if (!species) continue;
    if (species.attack > 5 && species.hunts.length > 0) return true;
  }
  return false;
}
