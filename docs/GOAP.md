# GOAP — Goal-Oriented Action Planning

## Overview

Agents currently use a **single-step priority system**: each tick, evaluate all possible actions, pick the one with the highest priority, do it. This produces reactive behavior — agents respond to the most urgent need — but never plan ahead. An agent that needs shelter will chop wood, but won't think "I need a workbench first, which needs 8 wood + 4 stone, so I should mine stone before building."

GOAP replaces the action-selection layer (not the action execution layer) with a planner that chains multiple actions into a sequence that achieves a goal. The execution code in NeedsSystem.ts stays the same — GOAP just picks what to do and in what order.

### What GOAP Is Not

GOAP is not a replacement for the entire AI. The system is layered:

```
Layer 1: Interrupt checks (flee from danger, critical needs)     ← stays as-is
Layer 2: GOAP planner (multi-step goal pursuit)                  ← NEW
Layer 3: Action execution (NeedsSystem executeAction)            ← stays as-is
```

Interrupts always override GOAP. If a bear appears while executing a 5-step plan, the agent flees. When the threat passes, the agent resumes or re-plans.

---

## Architecture

### World State

GOAP operates on a simplified snapshot of the world from the agent's perspective. This is **not** the full game state — it's what the agent knows and cares about.

```typescript
interface GOAPWorldState {
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
  hasCampfire: boolean;       // adjacent to campfire
  hasWorkbench: boolean;      // adjacent to workbench
  hasForge: boolean;          // adjacent to forge

  // Equipment
  hasAxe: boolean;
  hasPickaxe: boolean;
  hasWeapon: boolean;

  // World knowledge
  nearbyWood: boolean;        // tree within 15 tiles
  nearbyStone: boolean;       // rock within 15 tiles
  nearbyWater: boolean;       // water within 15 tiles
  nearbyFood: boolean;        // plant/berry within 15 tiles
  nearbyPrey: boolean;        // huntable animal within 15 tiles
  nearbyAgent: boolean;       // another agent within 15 tiles
  nearbyIronOre: boolean;     // iron ore within 15 tiles
}
```

### Goals

A goal is a desired world state condition. Goals are scored by urgency — the planner picks the most urgent goal and plans toward it.

```typescript
interface GOAPGoal {
  id: string;
  name: string;
  // What conditions must be true for this goal to be satisfied?
  conditions: Partial<GOAPWorldState>;
  // How urgent is this goal right now? (0-1, higher = plan for this first)
  urgency: (state: GOAPWorldState, agent: AgentState) => number;
  // Is this goal even relevant? (false = skip entirely)
  isRelevant: (state: GOAPWorldState, agent: AgentState) => boolean;
}
```

**Goal definitions:**

```typescript
const GOALS: GOAPGoal[] = [
  {
    id: 'survive_thirst',
    name: 'Drink water',
    conditions: { thirst: 80 },  // goal: thirst above 80
    urgency: (s) => quadratic(1 - s.thirst / 100),  // 0 when full, 1 when empty
    isRelevant: (s) => s.thirst < 50,
  },
  {
    id: 'survive_protein',
    name: 'Eat protein',
    conditions: { proteinHunger: 80 },
    urgency: (s) => quadratic(1 - s.proteinHunger / 100),
    isRelevant: (s) => s.proteinHunger < 50,
  },
  {
    id: 'survive_plant',
    name: 'Eat plants',
    conditions: { plantHunger: 80 },
    urgency: (s) => quadratic(1 - s.plantHunger / 100),
    isRelevant: (s) => s.plantHunger < 50,
  },
  {
    id: 'rest',
    name: 'Rest',
    conditions: { stamina: 80 },
    urgency: (s) => quadratic(1 - s.stamina / 100),
    isRelevant: (s) => s.stamina < 30,
  },
  {
    id: 'get_shelter',
    name: 'Build shelter',
    conditions: { shelter: 60 },
    urgency: (s) => linear(1 - s.shelter / 100) * 0.6,
    isRelevant: (s) => s.shelter < 40,
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
    isRelevant: (s) => s.social < 40,
  },
  {
    id: 'stockpile_wood',
    name: 'Gather wood',
    conditions: { wood: 15 },
    urgency: (s) => s.wood < 5 ? 0.35 : 0.15,
    isRelevant: (s) => s.wood < 15,
  },
  {
    id: 'stockpile_stone',
    name: 'Gather stone',
    conditions: { stone: 8 },
    urgency: (s) => s.stone < 3 ? 0.3 : 0.1,
    isRelevant: (s) => s.stone < 8,
  },
  {
    id: 'cook_food',
    name: 'Cook food',
    conditions: { food: 5 },
    urgency: (s) => s.meat > 2 && s.hasCampfire ? 0.35 : 0,
    isRelevant: (s) => s.meat > 2,
  },
];
```

### Actions

A GOAP action describes what it does to the world state (effects), what it requires (preconditions), and how expensive it is.

```typescript
interface GOAPAction {
  id: string;
  name: string;

  // What must be true before this action can execute?
  preconditions: Partial<GOAPWorldState>;

  // What changes after this action completes?
  effects: Partial<GOAPWorldState>;

  // How expensive is this action? Lower = preferred.
  // Cost should reflect time + stamina + risk.
  cost: (state: GOAPWorldState, agent: AgentState) => number;

  // How many ticks does this action take? (estimate for planning)
  estimatedTicks: number;

  // What NeedsSystem action does this map to?
  agentAction: AgentAction;

  // Can this action even be attempted right now?
  isValid: (state: GOAPWorldState, agent: AgentState, world: World) => boolean;
}
```

**Action definitions:**

```typescript
const ACTIONS: GOAPAction[] = [
  // --- Gathering ---
  {
    id: 'chop_wood',
    name: 'Chop tree',
    preconditions: { nearbyWood: true },
    effects: { wood: +5 },  // approximate yield per tree
    cost: (s, a) => 10 / (1 + a.skills.woodcutting.level * 0.01),  // cheaper with skill
    estimatedTicks: 30,
    agentAction: 'harvesting',
    isValid: (s, a, w) => w.findNearestTree(a.x, a.y, 15) !== null,
  },
  {
    id: 'mine_stone',
    name: 'Mine rock',
    preconditions: { nearbyStone: true },
    effects: { stone: +3 },
    cost: (s, a) => 12 / (1 + a.skills.mining.level * 0.01),
    estimatedTicks: 25,
    agentAction: 'harvesting',
    isValid: (s, a, w) => w.findNearestRock(a.x, a.y, 15) !== null,
  },
  {
    id: 'forage_plants',
    name: 'Gather berries/herbs',
    preconditions: { nearbyFood: true },
    effects: { plantHunger: +15 },
    cost: () => 8,
    estimatedTicks: 15,
    agentAction: 'harvesting',
    isValid: (s, a, w) => w.findNearestPlant(a.x, a.y, 15) !== null,
  },
  {
    id: 'hunt_animal',
    name: 'Hunt animal',
    preconditions: { nearbyPrey: true, hasWeapon: true },
    effects: { meat: +5, proteinHunger: +25 },
    cost: (s, a) => 20 / (1 + a.skills.combat.level * 0.01),
    estimatedTicks: 60,
    agentAction: 'harvesting',
    isValid: (s, a, w) => {
      // Check there's actually huntable prey nearby
      return w.animals.some(an => an.alive && distance(a.x, a.y, an.x, an.y) < 15);
    },
  },
  {
    id: 'hunt_unarmed',
    name: 'Hunt (bare hands)',
    preconditions: { nearbyPrey: true },
    effects: { meat: +3, proteinHunger: +15 },
    cost: (s, a) => 30 / (1 + a.skills.combat.level * 0.01),  // more expensive unarmed
    estimatedTicks: 80,
    agentAction: 'harvesting',
    isValid: (s, a, w) => {
      return w.animals.some(an => an.alive && distance(a.x, a.y, an.x, an.y) < 15);
    },
  },
  {
    id: 'mine_iron',
    name: 'Mine iron ore',
    preconditions: { nearbyIronOre: true, hasPickaxe: true },
    effects: { iron_ore: +2 },
    cost: () => 15,
    estimatedTicks: 40,
    agentAction: 'harvesting',
    isValid: (s, a, w) => w.findNearest(a.x, a.y, TileType.IRON_ORE) !== null,
  },

  // --- Consuming ---
  {
    id: 'drink_water',
    name: 'Drink water',
    preconditions: { nearbyWater: true },
    effects: { thirst: +30 },
    cost: () => 5,
    estimatedTicks: 10,
    agentAction: 'drinking',
    isValid: (s, a, w) => w.findNearest(a.x, a.y, TileType.WATER) !== null,
  },
  {
    id: 'eat_food',
    name: 'Eat from inventory',
    preconditions: {},  // needs food in inventory, checked by isValid
    effects: { proteinHunger: +12, plantHunger: +12 },
    cost: () => 3,
    estimatedTicks: 5,
    agentAction: 'eating',
    isValid: (s, a) => a.resources.food > 0 || a.resources.meat > 0,
  },
  {
    id: 'rest',
    name: 'Rest',
    preconditions: {},
    effects: { stamina: +30 },
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
    isValid: (s, a) => a.resources.wood >= 3 && a.resources.stone >= 2
      && a.skills.building.level >= 5,
  },
  {
    id: 'build_workbench',
    name: 'Build workbench',
    preconditions: { wood: 8, stone: 4 },
    effects: { hasWorkbench: true },
    cost: () => 12,
    estimatedTicks: 15,
    agentAction: 'building',
    isValid: (s, a) => a.resources.wood >= 8 && a.resources.stone >= 4
      && a.skills.building.level >= 10,
  },
  {
    id: 'build_wall',
    name: 'Build wall',
    preconditions: { wood: 5, hasWorkbench: true },
    effects: { shelter: +20 },
    cost: (s, a) => 10 / (1 + a.skills.building.level * 0.01),
    estimatedTicks: 15,
    agentAction: 'building',
    isValid: (s, a) => a.resources.wood >= 5 && a.skills.building.level >= 3,
  },
  {
    id: 'build_forge',
    name: 'Build forge',
    preconditions: { stone: 12, wood: 8, hasWorkbench: true },
    effects: { hasForge: true },
    cost: () => 20,
    estimatedTicks: 20,
    agentAction: 'building',
    isValid: (s, a) => a.resources.stone >= 12 && a.resources.wood >= 8
      && a.skills.building.level >= 15,
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
    isValid: (s, a) => a.resources.wood >= 2 && a.resources.stone >= 3,
  },
  {
    id: 'craft_stone_pickaxe',
    name: 'Craft stone pickaxe',
    preconditions: { wood: 2, stone: 3, hasWorkbench: true },
    effects: { hasPickaxe: true },
    cost: () => 10,
    estimatedTicks: 20,
    agentAction: 'crafting',
    isValid: (s, a) => a.resources.wood >= 2 && a.resources.stone >= 3,
  },
  {
    id: 'craft_weapon',
    name: 'Craft weapon',
    preconditions: { wood: 5, hasWorkbench: true },
    effects: { hasWeapon: true },
    cost: () => 12,
    estimatedTicks: 25,
    agentAction: 'crafting',
    isValid: (s, a) => a.resources.wood >= 5,
  },
  {
    id: 'cook_meat',
    name: 'Cook meat',
    preconditions: { meat: 2, hasCampfire: true },
    effects: { proteinHunger: +20, food: +1 },
    cost: () => 6,
    estimatedTicks: 15,
    agentAction: 'crafting',
    isValid: (s, a) => a.resources.meat >= 2,
  },
  {
    id: 'smelt_iron',
    name: 'Smelt iron',
    preconditions: { iron_ore: 2, wood: 2, hasForge: true },
    effects: { iron_ingot: +1 },
    cost: () => 15,
    estimatedTicks: 30,
    agentAction: 'crafting',
    isValid: (s, a) => a.resources.iron_ore >= 2 && a.resources.wood >= 2,
  },

  // --- Social ---
  {
    id: 'socialize',
    name: 'Talk to nearby agent',
    preconditions: { nearbyAgent: true },
    effects: { social: +10 },
    cost: () => 5,
    estimatedTicks: 20,
    agentAction: 'socializing',
    isValid: (s) => s.nearbyAgent,
  },
];
```

---

## The Planner

### Algorithm: Backward-Chaining A*

The planner works **backward from the goal** to find a sequence of actions that reaches the goal from the current state.

```
1. Start with the goal conditions as "unsatisfied"
2. Find all actions whose effects satisfy at least one unsatisfied condition
3. For each candidate action:
   a. Mark its effects as "now satisfied"
   b. Add its preconditions to the "unsatisfied" set (if not already met by current state)
   c. Add the action's cost to the running total
4. Recurse: find actions that satisfy the new unsatisfied conditions
5. Stop when all conditions are either satisfied by actions or already true in the current state
6. Return the cheapest complete chain (A* by total cost)
```

### Constraints

- **Max plan depth:** 6 actions. Beyond this, the plan is too long and the world will change before it completes. A 6-step plan at ~30 ticks each = ~18 seconds of committed behavior.
- **Max planning time:** 50 iterations of the search. If no plan is found within 50 expansions, fall back to the single-step priority system.
- **Stamina budget:** The planner estimates total stamina cost of the plan. If the agent can't afford it, prefer shorter plans or insert a rest action.

```typescript
function planGOAP(
  agent: AgentState,
  world: World,
  currentState: GOAPWorldState,
  goal: GOAPGoal,
  actions: GOAPAction[],
  maxDepth: number = 6,
  maxIterations: number = 50
): GOAPAction[] | null {
  // A* backward chaining
  const openSet: PlanNode[] = [];
  let iterations = 0;

  // Start node: goal conditions unsatisfied
  const startNode: PlanNode = {
    unsatisfied: getUnsatisfied(goal.conditions, currentState),
    actions: [],
    cost: 0,
    state: { ...currentState },
  };
  openSet.push(startNode);

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;
    // Pick lowest-cost node
    openSet.sort((a, b) => a.cost - b.cost);
    const node = openSet.shift()!;

    // Check if all conditions are satisfied by current world state
    if (node.unsatisfied.length === 0) {
      return node.actions.reverse();  // backward chain → reverse for execution order
    }

    // Max depth reached
    if (node.actions.length >= maxDepth) continue;

    // Try each action
    for (const action of actions) {
      if (!action.isValid(node.state, agent, world)) continue;

      // Does this action satisfy at least one unsatisfied condition?
      const satisfies = node.unsatisfied.some(cond =>
        action.effects[cond.key] !== undefined
      );
      if (!satisfies) continue;

      // Apply action effects to simulated state
      const newState = applyEffects(node.state, action.effects);
      const newUnsatisfied = getUnsatisfied(goal.conditions, newState);

      // Add action preconditions as new requirements
      for (const [key, val] of Object.entries(action.preconditions)) {
        if (!meetsCondition(currentState, key, val)) {
          newUnsatisfied.push({ key, required: val });
        }
      }

      // Deduplicate unsatisfied conditions
      const deduped = deduplicateConditions(newUnsatisfied);

      const newNode: PlanNode = {
        unsatisfied: deduped,
        actions: [...node.actions, action],
        cost: node.cost + action.cost(currentState, agent),
        state: newState,
      };

      openSet.push(newNode);
    }
  }

  return null;  // no plan found
}
```

### Skill-Weighted Costs

The key insight that makes GOAP produce intelligent behavior: **action costs decrease with skill level**. A skilled woodcutter plans "chop wood" as cheap, so the planner naturally routes through wood-heavy plans. A skilled miner plans "mine stone" as cheap, so the planner prefers stone-heavy paths.

```
// Unskilled agent wants shelter:
Plan: chop_wood (cost 10) → chop_wood (cost 10) → build_wall (cost 10)  = total 30

// Skilled woodcutter (level 50) wants shelter:
Plan: chop_wood (cost 6.7) → build_wall (cost 10)  = total 16.7
// One chop yields enough because of harvest speed bonus

// Skilled miner (level 50) wants tools:
Plan: mine_stone (cost 8) → craft_stone_axe (cost 10) = total 18
// Goes straight to stone, doesn't waste time on wood tools
```

This means agents **naturally specialize** through GOAP — they plan the cheapest path, and the cheapest path uses their strongest skills.

---

## Integration with Existing Systems

### Per-Tick Flow

```
function decideAction(agent, world, allAgents):
  // Layer 1: Interrupt checks (unchanged)
  if (fleeFromDanger(agent, world)) return fleeDecision;
  if (criticalNeed(agent)) return criticalDecision;
  if (selfDefense(agent)) return fightDecision;

  // Layer 2: GOAP planner
  const currentState = buildWorldState(agent, world);
  const plan = agent.currentPlan;

  // Re-plan if no plan, plan completed, or plan invalidated
  if (!plan || plan.length === 0 || planInvalidated(plan, currentState)) {
    const goal = selectGoal(agent, currentState);
    if (goal) {
      agent.currentPlan = planGOAP(agent, world, currentState, goal, ACTIONS);
    }
  }

  // Execute next step of plan
  if (agent.currentPlan && agent.currentPlan.length > 0) {
    const nextAction = agent.currentPlan[0];
    if (actionComplete(nextAction, agent, world)) {
      agent.currentPlan.shift();  // move to next step
      return decideAction(agent, world, allAgents);  // recurse for next action
    }
    return toDecision(nextAction);  // convert GOAP action → NeedsSystem decision
  }

  // Layer 3: Fallback to priority system (wander, opportunistic gathering)
  return wanderDecision();
```

### Plan Persistence

Plans persist across ticks on the agent state:

```typescript
// Add to AgentState
interface AgentState {
  // ...existing fields...
  currentPlan?: GOAPAction[];
  currentPlanGoal?: string;     // goal ID for debugging/UI
  planCreatedAt?: number;       // tick when plan was made
}
```

### Plan Invalidation

A plan is invalidated when the world changes enough that a step is no longer possible:

```typescript
function planInvalidated(plan: GOAPAction[], state: GOAPWorldState): boolean {
  // Check next action's preconditions against current state
  const next = plan[0];
  for (const [key, val] of Object.entries(next.preconditions)) {
    if (!meetsCondition(state, key, val)) return true;
  }
  // Plan too old (world has changed too much)
  if (agent.planCreatedAt && tickCount - agent.planCreatedAt > 300) return true;
  return false;
}
```

When invalidated, the agent re-plans on the next tick. If no plan is found (world state doesn't support the goal), it falls back to the priority system.

---

## Performance

### Why It's Cheap

- **Max 50 iterations** per plan attempt — worst case ~50 action evaluations
- **Plans cached** on agent — only re-plan when invalidated, not every tick
- **Re-plan staggered** — at most 1 agent re-plans per tick (round-robin)
- **Simple state** — GOAPWorldState is ~30 booleans/numbers, not the full world
- **6-step max** — search tree is bounded at depth 6

### Estimated Cost

With 50 agents and plans lasting ~100 ticks on average:
- ~0.5 agents re-plan per tick
- Each re-plan: ~50 iterations × ~20 actions = ~1000 comparisons
- Total per tick: ~500 simple comparisons — negligible vs pathfinding

---

## Example Plans

### Fresh agent, thirsty and hungry

```
Goal: survive_thirst (urgency: 0.8)
Current state: thirst=15, wood=1, no tools, no stations

Plan: drink_water
  → Walk to water, drink (+30 thirst)

(Single step — water is nearby, no prerequisites)
```

### Agent needs shelter, has nothing

```
Goal: get_shelter (urgency: 0.6)
Current state: shelter=10, wood=0, stone=0, no workbench

Plan:
  1. chop_wood     → get wood for workbench + wall
  2. mine_stone    → get stone for workbench
  3. build_workbench → enables wall recipe
  4. chop_wood     → get wood for wall
  5. build_wall    → shelter +20

(5 steps — agent chains gathering → infrastructure → building)
```

### Skilled hunter needs protein

```
Goal: survive_protein (urgency: 0.7)
Current state: proteinHunger=20, has bone_spear equipped, near deer

Plan:
  1. hunt_animal    → get meat + immediate protein from kill

(1 step — agent is already equipped and prey is nearby, direct route)
```

### Agent wants iron sword (long chain)

```
Goal: get_equipped (urgency: 0.3)
Current state: has stone tools, iron_ore nearby, no forge

Plan:
  1. mine_stone      → stone for forge
  2. chop_wood       → wood for forge
  3. build_forge     → enables smelting
  4. mine_iron       → get iron ore
  5. smelt_iron      → get iron ingot
  6. (re-plan)       → plan too long, will continue after re-evaluation

(Hits max depth at 6, completes first 5 steps, then re-plans for the remaining craft)
```

---

## Agent Personality Influence

Personality traits modify action costs, making different agents plan differently:

```typescript
function adjustCostForPersonality(baseCost: number, action: GOAPAction, agent: AgentState): number {
  let cost = baseCost;

  if (agent.personality.includes('industrious')) {
    // Industrious agents find gathering/building cheaper
    if (['chop_wood', 'mine_stone', 'build_wall', 'build_workbench'].includes(action.id)) {
      cost *= 0.7;
    }
  }

  if (agent.personality.includes('lazy')) {
    // Lazy agents find everything more expensive, especially physical work
    if (['chop_wood', 'mine_stone', 'hunt_animal'].includes(action.id)) {
      cost *= 1.5;
    }
    // But they prefer eating/resting (cheaper)
    if (['eat_food', 'rest'].includes(action.id)) {
      cost *= 0.8;
    }
  }

  if (agent.personality.includes('social')) {
    // Social agents find socializing cheap
    if (action.id === 'socialize') cost *= 0.5;
  }

  if (agent.personality.includes('loner')) {
    // Loners find socializing expensive
    if (action.id === 'socialize') cost *= 2.0;
  }

  return cost;
}
```

This means a lazy agent, given the same goal as an industrious agent, will plan a different path — preferring to rest more, forage rather than hunt, and avoid long building chains. Their plans reflect their personality.

---

## UI Visibility

The agent's current plan should be visible in the selection panel:

```
┌──────────────────────────────┐
│ Agent: Marcus                │
│ Goal: Build shelter          │
│ Plan: [3/5]                  │
│   ✅ Chop wood               │
│   ✅ Mine stone              │
│   → Build workbench          │
│   ○ Chop wood               │
│   ○ Build wall              │
└──────────────────────────────┘
```

This lets players understand *why* an agent is doing something — "Marcus is mining because he needs stone for a workbench, which he needs for a wall, which he needs for shelter."

---

## Types (for implementation)

```typescript
interface GOAPWorldState {
  [key: string]: number | boolean;
}

interface GOAPGoal {
  id: string;
  name: string;
  conditions: Partial<GOAPWorldState>;
  urgency: (state: GOAPWorldState, agent: AgentState) => number;
  isRelevant: (state: GOAPWorldState, agent: AgentState) => boolean;
}

interface GOAPAction {
  id: string;
  name: string;
  preconditions: Partial<GOAPWorldState>;
  effects: Partial<GOAPWorldState>;
  cost: (state: GOAPWorldState, agent: AgentState) => number;
  estimatedTicks: number;
  agentAction: AgentAction;
  isValid: (state: GOAPWorldState, agent: AgentState, world: World) => boolean;
}

interface PlanNode {
  unsatisfied: { key: string; required: number | boolean }[];
  actions: GOAPAction[];
  cost: number;
  state: GOAPWorldState;
}

// Add to AgentState
interface AgentPlanState {
  currentPlan?: GOAPAction[];
  currentPlanGoal?: string;
  planCreatedAt?: number;
  planStepIndex?: number;
}
```

---

## Implementation Order

```
Phase 1 — Foundation
  1. Define GOAPWorldState and buildWorldState() function
  2. Define GOAPGoal list with urgency scoring
  3. Define GOAPAction list with costs and effects
  4. Implement backward-chaining A* planner

Phase 2 — Integration
  5. Add plan persistence to AgentState
  6. Wire planner into decideAction() between interrupts and fallback
  7. Implement plan invalidation checks
  8. Add personality cost modifiers

Phase 3 — Tuning
  9. Balance action costs so plans are sensible
  10. Add re-plan staggering (max 1 per tick)
  11. Tune max depth / max iterations for performance

Phase 4 — UI
  12. Show current plan + goal in agent selection panel
  13. Show plan step progress (completed/current/pending)
```
