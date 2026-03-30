import type { AgentState, BehaviorGenome, RuleCondition, RuleEffect } from '../../shared/src/index.ts';
import type { World } from '../World.ts';
import { distance } from '../../shared/src/index.ts';
import { recordLifeEvent } from './LifeJournal.ts';

interface Decision {
  action: string;
  priority: number;
  target?: { x: number; y: number };
  reason?: string;
  [key: string]: any;
}

/**
 * Evaluate all enabled strategy rules and apply their effects to the decisions array.
 * Called after all normal decisions are collected, before final sort.
 */
export function evaluateStrategyRules(
  agent: AgentState,
  decisions: Decision[],
  world: World,
  tickCount: number
): void {
  const genome: BehaviorGenome = (agent as any).currentGenome;
  if (!genome || !genome.strategyRules) return;

  for (const rule of genome.strategyRules) {
    if (!rule.enabled) continue;
    if (!evaluateCondition(rule.condition, agent, world)) continue;

    // Record that this rule fired
    recordLifeEvent(agent, 'strategy_rule_fired', `Rule "${rule.name}" activated`, undefined, tickCount);

    // Apply effect
    applyEffect(rule.effect, rule.priority, rule.name, decisions, agent);
  }

  // Update active strategy rule names for wire format
  agent.activeStrategyRuleNames = genome.strategyRules
    .filter(r => r.enabled)
    .map(r => r.name);
}

/**
 * Recursively evaluate a rule condition.
 */
export function evaluateCondition(
  condition: RuleCondition,
  agent: AgentState,
  world: World
): boolean {
  switch (condition.type) {
    case 'need_below': {
      const val = getNestedValue(agent.needs, condition.field ?? '');
      return val !== undefined && val < (condition.value ?? 0);
    }
    case 'need_above': {
      const val = getNestedValue(agent.needs, condition.field ?? '');
      return val !== undefined && val > (condition.value ?? 0);
    }
    case 'resource_below': {
      const val = getNestedValue(agent.resources, condition.field ?? '');
      return val !== undefined && val < (condition.value ?? 0);
    }
    case 'resource_above': {
      const val = getNestedValue(agent.resources, condition.field ?? '');
      return val !== undefined && val > (condition.value ?? 0);
    }
    case 'health_percent': {
      return (agent.needs.health / 100) < (condition.value ?? 0) / 100;
    }
    case 'skill_level': {
      const field = condition.field ?? '';
      const skill = (agent.skills as any)[field];
      if (!skill) return false;
      return skill.level >= (condition.value ?? 0);
    }
    case 'deaths_remaining': {
      return (agent.livesRemaining ?? 100) <= (condition.value ?? 0);
    }
    case 'near_entity': {
      return checkNearEntity(agent, world, condition.entityType ?? '', condition.range ?? 10);
    }
    case 'time_of_day': {
      // Not implemented yet (no day/night cycle)
      return false;
    }
    case 'and': {
      return (condition.conditions ?? []).every(c => evaluateCondition(c, agent, world));
    }
    case 'or': {
      return (condition.conditions ?? []).some(c => evaluateCondition(c, agent, world));
    }
    case 'not': {
      const sub = condition.conditions?.[0];
      return sub ? !evaluateCondition(sub, agent, world) : false;
    }
    default:
      return false;
  }
}

function applyEffect(
  effect: RuleEffect,
  rulePriority: number,
  ruleName: string,
  decisions: Decision[],
  agent: AgentState
): void {
  switch (effect.type) {
    case 'boost_priority':
      for (const d of decisions) {
        if (d.action === effect.action) {
          d.priority += effect.amount ?? 0;
        }
      }
      break;

    case 'suppress_action':
      for (const d of decisions) {
        if (d.action === effect.action) {
          d.priority -= effect.amount ?? 0;
        }
      }
      break;

    case 'force_action':
      decisions.push({
        action: effect.action ?? 'idle',
        priority: rulePriority,
        reason: `strategy: ${ruleName}`,
      });
      break;

    case 'flee_from':
      decisions.push({
        action: 'fleeing',
        priority: rulePriority,
        reason: `strategy: ${ruleName} (flee)`,
      });
      break;

    case 'modify_threshold':
      // Transient threshold override — stored on agent for this tick only
      if (!((agent as any)._thresholdOverrides)) {
        (agent as any)._thresholdOverrides = {};
      }
      if (effect.targetField) {
        (agent as any)._thresholdOverrides[effect.targetField] = effect.targetValue;
      }
      break;

    case 'modify_weight':
      // Transient goal weight modifier
      break;

    case 'prefer_target':
      // Not yet implemented
      break;
  }
}

function checkNearEntity(
  agent: AgentState,
  world: World,
  entityType: string,
  range: number
): boolean {
  const ax = Math.floor(agent.x);
  const ay = Math.floor(agent.y);

  // Check for specific types
  if (entityType === 'water') {
    const water = world.findNearest(ax, ay, 1 /* TileType.WATER */);
    return water !== null && distance(ax, ay, water.x, water.y) <= range;
  }

  if (entityType === 'tree') {
    return world.trees.some((t: any) => !t.isStump && distance(ax, ay, t.x, t.y) <= range);
  }

  if (entityType.startsWith('animal:')) {
    const species = entityType.slice(7);
    return world.animals.some((a: any) => a.species === species && a.alive && distance(ax, ay, a.x, a.y) <= range);
  }

  // Generic animal check
  if (entityType === 'animal') {
    return world.animals.some((a: any) => a.alive && distance(ax, ay, a.x, a.y) <= range);
  }

  return false;
}

function getNestedValue(obj: any, path: string): number | undefined {
  const val = obj[path];
  return typeof val === 'number' ? val : undefined;
}
